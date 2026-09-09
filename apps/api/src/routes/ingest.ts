import { Router } from 'express';
import { ingestRequestSchema, type Frame } from '@lacs/contracts';
import { DeviceModel, EventModel, ReadingModel } from '../models/index.js';
import { requireDevice } from '../middleware/auth.js';
import { asyncHandler, validateBody } from '../middleware/helpers.js';
import { frameBus } from '../bus.js';

export const ingestRouter = Router();

/** Mongo's duplicate-key code. Here it means "already stored", not a failure. */
const DUPLICATE_KEY = 11000;

interface BulkWriteErrorLike {
  code?: number;
  writeErrors?: Array<{ err?: { code?: number }; code?: number }>;
  result?: { nInserted?: number; insertedCount?: number };
  insertedDocs?: unknown[];
}

function countDuplicates(err: BulkWriteErrorLike): { duplicates: number; other: number } {
  const errors = err.writeErrors ?? [];
  let duplicates = 0;
  let other = 0;
  for (const e of errors) {
    const code = e.err?.code ?? e.code;
    if (code === DUPLICATE_KEY) duplicates += 1;
    else other += 1;
  }
  if (errors.length === 0 && err.code === DUPLICATE_KEY) duplicates = 1;
  return { duplicates, other };
}

interface InsertManyCapable {
  insertMany(docs: object[], options: { ordered: boolean }): Promise<unknown[]>;
}

/**
 * Unordered insert that treats duplicate keys as "already stored".
 *
 * Mongoose's insertMany overloads do not unify across two differently-typed
 * models, so the models are passed through a narrow structural type here
 * rather than being looped over directly.
 */
async function insertIgnoringDuplicates(
  model: InsertManyCapable,
  docs: object[],
): Promise<{ accepted: number; duplicates: number; rejected: number }> {
  if (docs.length === 0) return { accepted: 0, duplicates: 0, rejected: 0 };
  try {
    const inserted = await model.insertMany(docs, { ordered: false });
    return { accepted: inserted.length, duplicates: 0, rejected: 0 };
  } catch (err) {
    const { duplicates, other } = countDuplicates(err as BulkWriteErrorLike);
    return { accepted: docs.length - duplicates - other, duplicates, rejected: other };
  }
}

/** Beyond this, a device `ms` offset is not believable - fall back to arrival. */
const MAX_BACKDATE_MS = 24 * 60 * 60 * 1000;

/**
 * Spreads a batch across real time instead of stamping it all at arrival.
 *
 * The phone buffers while offline, so one flush can carry an hour of frames.
 * Stamping them all with the flush instant would collapse that hour into a
 * single point on every chart, and leave frames tied on `recordedAt` with no
 * stable order.
 *
 * The device has no clock, but its `ms` uptime counter is monotonic within a
 * power session. Anchoring the newest frame at arrival and back-dating the
 * rest by their `ms` delta reconstructs the real spacing. A device reboot
 * resets `ms`, which shows up as an implausible offset and falls back to
 * arrival rather than inventing a timestamp from last week.
 */
function buildTimestamper(frames: Frame[], arrivedAt: Date): (frame: Frame) => Date {
  const newestMs = frames.reduce((max, f) => (f.ms > max ? f.ms : max), 0);
  return (frame) => {
    const offset = newestMs - frame.ms;
    if (offset <= 0 || offset > MAX_BACKDATE_MS) return arrivedAt;
    return new Date(arrivedAt.getTime() - offset);
  };
}

/**
 * POST /ingest - the one write path for device data.
 *
 * Both bridges use it: the phone flushing its SQLite buffer, and the node
 * itself over WiFi. Authenticated by device token, so a caller can only ever
 * write frames for its own deviceId regardless of what the payload claims.
 *
 * Idempotent by construction. Inserts are unordered and duplicate-key errors
 * on {deviceId, seq} are counted rather than raised, so replaying a batch is
 * always safe - which is exactly what an offline phone does on reconnect.
 */
ingestRouter.post(
  '/',
  requireDevice,
  validateBody(ingestRequestSchema),
  asyncHandler(async (req, res) => {
    const { deviceId, ownerId } = req.device!;
    const { frames } = req.body as { frames: Frame[] };
    const arrivedAt = new Date();
    const timestampFor = buildTimestamper(frames, arrivedAt);

    const readings: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    let latestFw: string | null = null;

    for (const frame of frames) {
      // The device token decides the deviceId. A frame claiming another id is
      // ignored rather than trusted.
      if (frame.id !== deviceId) continue;

      switch (frame.t) {
        case 'telemetry':
          readings.push({
            deviceId,
            ownerId,
            seq: frame.seq,
            deviceMs: frame.ms,
            recordedAt: timestampFor(frame),
            ppg: frame.ppg,
            imu: frame.imu,
            gsr: frame.gsr,
            steps: frame.steps ?? null,
            motor: frame.motor,
            flags: frame.flags,
          });
          break;
        case 'event':
          events.push({
            deviceId,
            ownerId,
            seq: frame.seq,
            deviceMs: frame.ms,
            recordedAt: timestampFor(frame),
            kind: frame.kind,
            value: frame.value,
          });
          break;
        case 'status':
          latestFw = frame.fw;
          break;
        case 'ack':
          break;
      }

      frameBus.publish(deviceId, frame);
    }

    // Status and ack frames are fanned out live but never stored, so they
    // count as neither accepted nor rejected.
    const stored = readings.length + events.length;
    const ignored = frames.filter((f) => f.t === 'status' || f.t === 'ack').length;
    let rejected = frames.length - stored - ignored;

    const readingResult = await insertIgnoringDuplicates(
      ReadingModel as unknown as InsertManyCapable,
      readings,
    );
    const eventResult = await insertIgnoringDuplicates(
      EventModel as unknown as InsertManyCapable,
      events,
    );

    const accepted = readingResult.accepted + eventResult.accepted;
    const duplicates = readingResult.duplicates + eventResult.duplicates;
    rejected += readingResult.rejected + eventResult.rejected;

    await DeviceModel.updateOne(
      { deviceId },
      { $set: { lastSeenAt: arrivedAt, ...(latestFw ? { fw: latestFw } : {}) } },
    );

    res.json({ accepted, duplicates, rejected });
  }),
);
