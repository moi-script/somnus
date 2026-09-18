import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  deviceKindOf,
  nightDateFor,
  nightWindow,
  summarizeNight,
  NIGHT,
  type LightSample,
  type LightSource,
  type LightState,
  type NightSummary,
  type PresenceSample,
} from '@lacs/contracts';
import { RoomFrameModel } from '../models/index.js';
import { requireOwnedDevice, requireUser } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/helpers.js';

/** Reads for the room unit: what it sees now, and what each night looked like. */
export const roomRouter = Router();

interface RoomFrameLean {
  t: 'presence' | 'light';
  recordedAt: Date;
  present?: boolean;
  state?: LightState;
  source?: LightSource;
}

/**
 * The browser's Date.getTimezoneOffset(). A night runs 18:00-14:00 local, and
 * the server has no business guessing whose local that is.
 */
const tzSchema = z.coerce.number().int().min(-840).max(840).default(0);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date like 2026-09-17');
const limitSchema = z.coerce.number().int().min(1).max(31).default(14);

function requireRoom(req: Request, res: Response, next: NextFunction): void {
  if (deviceKindOf(req.params.deviceId!) !== 'room') {
    res.status(404).json({ error: 'not_a_room', detail: 'only a room unit reports the room' });
    return;
  }
  next();
}

const roomOnly = [requireUser, requireOwnedDevice, requireRoom];

function badRequest(res: Response, issues: z.ZodIssue[]): void {
  res.status(400).json({
    error: 'validation_failed',
    issues: issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`),
  });
}

async function summarize(deviceId: string, date: string, tz: number): Promise<NightSummary> {
  const window = nightWindow(date, tz);
  const [frames, lightBefore] = await Promise.all([
    RoomFrameModel.find({
      deviceId,
      recordedAt: { $gte: new Date(window.start - NIGHT.staleMs), $lt: new Date(window.end) },
    })
      .sort({ recordedAt: 1 })
      .lean<RoomFrameLean[]>(),
    // The bulb's state as the night began, however long ago it was set.
    RoomFrameModel.findOne({ deviceId, t: 'light', recordedAt: { $lt: new Date(window.start) } })
      .sort({ recordedAt: -1 })
      .lean<RoomFrameLean>(),
  ]);

  const presence: PresenceSample[] = [];
  const light: LightSample[] = [];
  for (const f of lightBefore ? [lightBefore, ...frames] : frames) {
    const at = f.recordedAt.getTime();
    if (f.t === 'presence') presence.push({ at, present: Boolean(f.present) });
    else if (f.state && f.source) light.push({ at, state: f.state, source: f.source });
  }
  return summarizeNight(date, window, presence, light);
}

roomRouter.get(
  '/:deviceId/room/latest',
  ...roomOnly,
  asyncHandler(async (req, res) => {
    const deviceId = req.params.deviceId!;
    const [presence, light] = await Promise.all([
      RoomFrameModel.findOne({ deviceId, t: 'presence' })
        .sort({ recordedAt: -1 })
        .lean<RoomFrameLean>(),
      RoomFrameModel.findOne({ deviceId, t: 'light' }).sort({ recordedAt: -1 }).lean<RoomFrameLean>(),
    ]);
    res.json({
      presence: presence
        ? { present: Boolean(presence.present), at: presence.recordedAt.toISOString() }
        : null,
      light: light
        ? { state: light.state, source: light.source, at: light.recordedAt.toISOString() }
        : null,
    });
  }),
);

roomRouter.get(
  '/:deviceId/nights/:date',
  ...roomOnly,
  asyncHandler(async (req, res) => {
    const date = dateSchema.safeParse(req.params.date);
    const tz = tzSchema.safeParse(req.query.tz);
    if (!date.success) return badRequest(res, date.error.issues);
    if (!tz.success) return badRequest(res, tz.error.issues);
    res.json(await summarize(req.params.deviceId!, date.data, tz.data));
  }),
);

/** Newest first, starting with the night in progress or just ended. */
roomRouter.get(
  '/:deviceId/nights',
  ...roomOnly,
  asyncHandler(async (req, res) => {
    const tz = tzSchema.safeParse(req.query.tz);
    const limit = limitSchema.safeParse(req.query.limit);
    if (!tz.success) return badRequest(res, tz.error.issues);
    if (!limit.success) return badRequest(res, limit.error.issues);

    const newest = nightDateFor(Date.now(), tz.data);
    const dates = Array.from({ length: limit.data }, (_, i) => {
      const d = new Date(`${newest}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      return d.toISOString().slice(0, 10);
    });
    const nights = await Promise.all(dates.map((d) => summarize(req.params.deviceId!, d, tz.data)));
    res.json(nights);
  }),
);
