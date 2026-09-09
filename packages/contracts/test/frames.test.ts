import { describe, expect, it } from 'vitest';
import {
  FrameLineParser,
  encodeCommand,
  frameSchema,
  parseFrameLine,
  commandSchema,
} from '../src/index.js';

/**
 * Lines below are byte-for-byte what the firmware emits, including
 * ArduinoJson's habit of dropping the decimal on whole floats ("az":1, not
 * "az":1.0). Anything stricter than this rejects real hardware output.
 */
const TELEMETRY =
  '{"v":1,"t":"telemetry","id":"lacs-7a3f21","seq":142,"ms":28450,' +
  '"ppg":{"ok":true,"finger":true,"ir":98421,"red":87233,"bpm":72.4,"bpmAvg":71},' +
  '"imu":{"ok":true,"ax":0.01,"ay":-0.02,"az":1,"gx":0.4,"gy":-1.2,"gz":0.1,"mag":1.01,"tempC":31.2},' +
  '"gsr":{"ok":true,"raw":1820,"volt":1.47,"base":1800},' +
  '"motor":{"on":false,"pattern":"idle"},"flags":[]}';

const STATUS =
  '{"v":1,"t":"status","id":"lacs-7a3f21","seq":1,"ms":812,"fw":"0.1.0",' +
  '"transport":"serial","online":3,"total":3,' +
  '"sensors":{"max30102":true,"mpu6050":true,"gsr":true},' +
  '"config":{"hz":5,"gsrDelta":250,"fallHighG":2.5,"freeFallG":0.3,"fingerLostMs":3000,"human":true}}';

const EVENT =
  '{"v":1,"t":"event","id":"lacs-7a3f21","seq":143,"ms":28460,"kind":"fall","value":3.12}';

// Firmware omits "detail" entirely when it passes nullptr.
const ACK_NO_DETAIL =
  '{"v":1,"t":"ack","id":"lacs-7a3f21","seq":144,"ms":30100,"cmd":"config","ok":true}';

describe('frame schemas', () => {
  it('accepts a real telemetry frame', () => {
    const r = parseFrameLine(TELEMETRY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.frame.t).toBe('telemetry');
    if (r.frame.t !== 'telemetry') return;
    expect(r.frame.ppg.bpmAvg).toBe(71);
    expect(r.frame.imu.az).toBe(1);
    expect(r.frame.gsr.raw).toBe(1820);
  });

  it('accepts status, event and detail-less ack frames', () => {
    for (const line of [STATUS, EVENT, ACK_NO_DETAIL]) {
      expect(parseFrameLine(line).ok).toBe(true);
    }
  });

  it('narrows on the t discriminator', () => {
    const frame = frameSchema.parse(JSON.parse(EVENT));
    if (frame.t === 'event') {
      expect(frame.kind).toBe('fall');
      expect(frame.value).toBeCloseTo(3.12);
    } else {
      throw new Error('discriminator did not narrow to event');
    }
  });

  it('rejects a payload version it does not know rather than guessing', () => {
    const r = parseFrameLine(TELEMETRY.replace('"v":1', '"v":9'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('schema');
  });

  it('rejects a GSR reading outside 12-bit range', () => {
    const r = parseFrameLine(TELEMETRY.replace('"raw":1820', '"raw":9999'));
    expect(r.ok).toBe(false);
  });

  it('reports malformed JSON separately from schema failure', () => {
    const r = parseFrameLine('{"v":1,"t":"telemetry"');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('bad-json');
  });

  it('treats the human stream as not-a-frame, not an error', () => {
    const r = parseFrameLine('[DATA] ppg ir=98421 bpm=72 finger=Y | gsr 1820');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not-a-frame');
  });
});

// v2 adds SpO2 and step counting. Both are optional, so a device on either
// version reports into the same backend.
const TELEMETRY_V2 =
  '{"v":2,"t":"telemetry","id":"lacs-7a3f21","seq":150,"ms":30000,' +
  '"ppg":{"ok":true,"finger":true,"ir":98421,"red":87233,"bpm":72.4,"bpmAvg":71,"spo2":97,"spo2Valid":true},' +
  '"imu":{"ok":true,"ax":0.01,"ay":-0.02,"az":1,"gx":0.4,"gy":-1.2,"gz":0.1,"mag":1.01,"tempC":31.2},' +
  '"gsr":{"ok":true,"raw":1820,"volt":1.47,"base":1800},' +
  '"steps":{"count":4213,"cadence":98},' +
  '"motor":{"on":false,"pattern":"idle"},"flags":[]}';

describe('payload versions', () => {
  it('accepts a v2 frame with SpO2 and steps', () => {
    const r = parseFrameLine(TELEMETRY_V2);
    expect(r.ok).toBe(true);
    if (!r.ok || r.frame.t !== 'telemetry') return;
    expect(r.frame.ppg.spo2).toBe(97);
    expect(r.frame.ppg.spo2Valid).toBe(true);
    expect(r.frame.steps?.count).toBe(4213);
  });

  // A phone can hold frames buffered before a firmware update. Rejecting them
  // would throw away real recordings.
  it('still accepts a v1 frame that carries neither field', () => {
    const r = parseFrameLine(TELEMETRY);
    expect(r.ok).toBe(true);
    if (!r.ok || r.frame.t !== 'telemetry') return;
    expect(r.frame.ppg.spo2).toBeUndefined();
    expect(r.frame.steps).toBeUndefined();
  });

  it('carries the rejected sentinel through rather than hiding it', () => {
    const r = parseFrameLine(
      TELEMETRY_V2.replace('"spo2":97,"spo2Valid":true', '"spo2":-1,"spo2Valid":false'),
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.frame.t !== 'telemetry') return;
    // The app keys off spo2Valid; -1 must never be shown as a percentage.
    expect(r.frame.ppg.spo2).toBe(-1);
    expect(r.frame.ppg.spo2Valid).toBe(false);
  });

  it('rejects an impossible oxygen percentage', () => {
    expect(parseFrameLine(TELEMETRY_V2.replace('"spo2":97', '"spo2":140')).ok).toBe(false);
  });

  it('rejects a version nobody supports', () => {
    expect(parseFrameLine(TELEMETRY_V2.replace('"v":2', '"v":3')).ok).toBe(false);
  });
});

describe('FrameLineParser', () => {
  it('separates frames from the interleaved human stream', () => {
    const parser = new FrameLineParser();
    const chunk =
      '[BOOT] LACS node fw0.1.0  id=lacs-7a3f21\n' +
      STATUS + '\n' +
      '[DATA] ppg ir=98421 bpm=72 finger=Y\n' +
      TELEMETRY + '\n';

    const frames = parser.pushFrames(chunk);
    expect(frames.map((f) => f.t)).toEqual(['status', 'telemetry']);
  });

  // The failure this class exists to prevent: serial reads and BLE
  // notifications both hand you arbitrary byte boundaries.
  it('reassembles a frame split across chunks', () => {
    const parser = new FrameLineParser();
    const cut = 40;
    expect(parser.pushFrames(TELEMETRY.slice(0, cut))).toHaveLength(0);
    expect(parser.pushFrames(TELEMETRY.slice(cut))).toHaveLength(0);
    const frames = parser.pushFrames('\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.seq).toBe(142);
  });

  it('holds an unterminated line as pending instead of emitting it', () => {
    const parser = new FrameLineParser();
    parser.pushFrames(TELEMETRY);
    expect(parser.pending).toBe(TELEMETRY);
  });

  it('drops a runaway line rather than growing without bound', () => {
    const parser = new FrameLineParser(128);
    parser.push('x'.repeat(5000));
    expect(parser.pending.length).toBeLessThanOrEqual(128);
  });

  it('survives CRLF line endings', () => {
    const parser = new FrameLineParser();
    expect(parser.pushFrames(TELEMETRY + '\r\n')).toHaveLength(1);
  });
});

describe('commands', () => {
  it('encodes a buzz command the firmware parser accepts', () => {
    expect(encodeCommand({ cmd: 'buzz', pattern: 'double', ms: 300 })).toBe(
      '{"cmd":"buzz","pattern":"double","ms":300}',
    );
  });

  it('refuses idle as a buzz pattern', () => {
    expect(commandSchema.safeParse({ cmd: 'buzz', pattern: 'idle' }).success).toBe(false);
  });

  it('clamps telemetry rate to what the firmware honours', () => {
    expect(commandSchema.safeParse({ cmd: 'config', hz: 5 }).success).toBe(true);
    expect(commandSchema.safeParse({ cmd: 'config', hz: 50 }).success).toBe(false);
  });
});
