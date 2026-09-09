import type { Command, Frame, IngestResponse, QueuedCommand } from '@lacs/contracts';
import { API_PREFIX, encodeCommand } from '@lacs/contracts';
import { API_URL } from '@/lib/api';
import { bufferFrames, clearBatch, pendingCount, takeBatch, trim } from './buffer';

/**
 * The bridge loop: BLE in, HTTP out, commands back.
 *
 * Frames are written to SQLite first and only then uploaded, so losing the
 * network changes the upload cadence and nothing else.
 */

const FLUSH_MS = 5000;
const COMMAND_POLL_MS = 4000;
const TOKEN_KEY = 'lacs.deviceToken';

export function deviceToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setDeviceToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

async function online(): Promise<boolean> {
  try {
    const { Network } = await import('@capacitor/network');
    return (await Network.getStatus()).connected;
  } catch {
    return navigator.onLine;
  }
}

export interface SyncStats {
  buffered: number;
  uploaded: number;
  lastError: string | null;
  lastFlushAt: number | null;
}

export class Bridge {
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private commandTimer: ReturnType<typeof setInterval> | null = null;
  private uploaded = 0;
  private lastError: string | null = null;
  private lastFlushAt: number | null = null;

  constructor(
    private readonly token: string,
    /** Writes a line to the node over BLE. */
    private readonly send: (line: string) => Promise<void>,
    private readonly onStats: (stats: SyncStats) => void,
  ) {}

  async ingestFrame(frame: Frame): Promise<void> {
    await bufferFrames([frame]);
  }

  start(): void {
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_MS);
    this.commandTimer = setInterval(() => void this.pollCommands(), COMMAND_POLL_MS);
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.commandTimer) clearInterval(this.commandTimer);
    this.flushTimer = null;
    this.commandTimer = null;
  }

  private async report(): Promise<void> {
    this.onStats({
      buffered: await pendingCount().catch(() => 0),
      uploaded: this.uploaded,
      lastError: this.lastError,
      lastFlushAt: this.lastFlushAt,
    });
  }

  async flush(): Promise<void> {
    if (!(await online())) {
      this.lastError = 'Offline - buffering locally';
      await this.report();
      return;
    }

    const { ids, frames } = await takeBatch(200);
    if (frames.length === 0) {
      await this.report();
      return;
    }

    try {
      const res = await fetch(`${API_URL}${API_PREFIX}/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ frames }),
      });

      if (!res.ok) {
        // 4xx will not become valid on retry; dropping keeps the queue moving
        // instead of wedging every later frame behind a bad batch.
        if (res.status >= 400 && res.status < 500) {
          await clearBatch(ids);
          this.lastError = `Server rejected a batch (${res.status})`;
        } else {
          this.lastError = `Server error ${res.status}, will retry`;
        }
        await this.report();
        return;
      }

      const body = (await res.json()) as IngestResponse;
      // Duplicates count as delivered - that is what makes the retry safe.
      this.uploaded += body.accepted + body.duplicates;
      await clearBatch(ids);
      await trim();
      this.lastError = null;
      this.lastFlushAt = Date.now();
    } catch (err) {
      this.lastError = (err as Error).message;
    }

    await this.report();
  }

  /** Drains the server's queue and writes each command to the node. */
  private async pollCommands(): Promise<void> {
    if (!(await online())) return;

    try {
      const res = await fetch(`${API_URL}${API_PREFIX}/commands/pending`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) return;

      const commands = (await res.json()) as QueuedCommand[];
      for (const queued of commands) {
        await this.send(encodeCommand(queued.command as Command));
        await fetch(`${API_URL}${API_PREFIX}/commands/${queued.id}/ack`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({ ok: true, detail: 'written over BLE' }),
        });
      }
    } catch {
      // Network flap. flush() already surfaces connectivity problems.
    }
  }
}
