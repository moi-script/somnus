import { SerialPort } from 'serialport';
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API_PREFIX,
  FrameLineParser,
  encodeCommand,
  type Command,
  type Frame,
} from '@lacs/contracts';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../../.env') });

const SERIAL_PATH = process.env.SERIAL_PORT ?? 'COM5';
const BAUD = Number(process.env.SERIAL_BAUD ?? 115200);
const API_URL = process.env.BRIDGE_API_URL ?? 'http://localhost:4000';
const DEVICE_TOKEN = process.env.BRIDGE_DEVICE_TOKEN ?? '';

/** Frames are batched rather than posted individually: at 5 Hz a per-frame
 *  POST would mean 5 round trips a second for no benefit. */
const FLUSH_INTERVAL_MS = 1000;
const FLUSH_MAX_FRAMES = 200;
/** Roughly two minutes of buffer at 5 Hz before the oldest frames are shed. */
const MAX_QUEUE = 600;
const COMMAND_POLL_MS = 2000;

if (!DEVICE_TOKEN) {
  console.error(
    'BRIDGE_DEVICE_TOKEN is not set.\n' +
      'Claim the device in the dashboard (or POST /api/v1/devices/claim), then\n' +
      'copy the ingestToken it returns into .env.',
  );
  process.exit(1);
}

const parser = new FrameLineParser();
let queue: Frame[] = [];
let pendingCommands = new Map<string, Command>();

const stats = { frames: 0, posted: 0, duplicates: 0, dropped: 0 };

const port = new SerialPort({ path: SERIAL_PATH, baudRate: BAUD }, (err) => {
  if (err) {
    console.error(`[bridge] cannot open ${SERIAL_PATH}: ${err.message}`);
    console.error('[bridge] close the Arduino Serial Monitor - it holds the port exclusively.');
    process.exit(1);
  }
  console.log(`[bridge] listening on ${SERIAL_PATH} @${BAUD}, posting to ${API_URL}`);
});

port.on('data', (chunk: Buffer) => {
  for (const result of parser.push(chunk.toString('utf8'))) {
    if (result.ok) {
      stats.frames += 1;
      queue.push(result.frame);
      // Shed the oldest rather than the newest: if the API is down, recent
      // data is what someone watching a live dashboard actually wants.
      if (queue.length > MAX_QUEUE) {
        queue.splice(0, queue.length - MAX_QUEUE);
        stats.dropped += 1;
      }
    } else if (result.reason === 'not-a-frame') {
      // The firmware's human stream. Echo it so the bridge doubles as a
      // serial monitor.
      console.log(result.line);
    } else {
      console.warn(`[bridge] unusable line (${result.reason}): ${result.line.slice(0, 120)}`);
    }
  }
});

port.on('error', (err) => console.error(`[bridge] serial error: ${err.message}`));
port.on('close', () => {
  console.error('[bridge] serial port closed - was the board unplugged?');
  process.exit(1);
});

async function flush(): Promise<void> {
  if (queue.length === 0) return;

  const batch = queue.slice(0, FLUSH_MAX_FRAMES);
  try {
    const res = await fetch(`${API_URL}${API_PREFIX}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEVICE_TOKEN}`,
      },
      body: JSON.stringify({ frames: batch }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[bridge] ingest ${res.status}: ${body.slice(0, 200)}`);
      // 4xx will not fix itself on retry, so drop the batch rather than
      // wedging the queue behind frames the server will never accept.
      if (res.status >= 400 && res.status < 500) queue = queue.slice(batch.length);
      return;
    }

    const body = (await res.json()) as { accepted: number; duplicates: number };
    stats.posted += body.accepted;
    stats.duplicates += body.duplicates;
    queue = queue.slice(batch.length);
  } catch (err) {
    // Server down: keep the batch queued and try again next tick. This is the
    // same behaviour the phone's SQLite buffer gives, minus the durability.
    console.error(`[bridge] ingest failed, will retry: ${(err as Error).message}`);
  }
}

/**
 * Drains queued commands and writes them to the device.
 *
 * This is the half of the loop that makes a button in the browser move
 * hardware on the bench. The phone app does exactly this over BLE.
 */
async function pollCommands(): Promise<void> {
  try {
    const res = await fetch(`${API_URL}${API_PREFIX}/commands/pending`, {
      headers: { Authorization: `Bearer ${DEVICE_TOKEN}` },
    });
    if (!res.ok) return;

    const commands = (await res.json()) as Array<{ id: string; command: Command }>;
    for (const { id, command } of commands) {
      const line = encodeCommand(command);
      port.write(`${line}\n`);
      pendingCommands.set(command.cmd, command);
      console.log(`[bridge] -> ${line}`);

      // The firmware acks on its own line; this reports delivery, which is
      // what the dashboard needs to stop showing the command as pending.
      await fetch(`${API_URL}${API_PREFIX}/commands/${id}/ack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEVICE_TOKEN}`,
        },
        body: JSON.stringify({ ok: true, detail: 'written to serial' }),
      });
    }
  } catch {
    // Server unreachable. Ingest logs it already; no need to double up.
  }
}

setInterval(() => void flush(), FLUSH_INTERVAL_MS);
setInterval(() => void pollCommands(), COMMAND_POLL_MS);

setInterval(() => {
  console.log(
    `[bridge] frames=${stats.frames} posted=${stats.posted} dup=${stats.duplicates} ` +
      `dropped=${stats.dropped} queued=${queue.length}`,
  );
}, 15_000);

process.on('SIGINT', () => {
  console.log('\n[bridge] flushing before exit');
  void flush().finally(() => {
    port.close();
    process.exit(0);
  });
});
