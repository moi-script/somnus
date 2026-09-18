import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { claimDeviceSchema, deviceKindOf, readingsQuerySchema } from '@lacs/contracts';
import { DeviceModel, EventModel, ReadingModel } from '../models/index.js';
import { mintIngestToken, requireOwnedDevice, requireUser } from '../middleware/auth.js';
import { asyncHandler, validateBody } from '../middleware/helpers.js';

export const devicesRouter = Router();

/**
 * No frame in this long and the dashboard shows the device as offline. A band
 * streams several frames a second; a quiet room unit only sends a presence
 * heartbeat every 60 s, so it gets more slack.
 */
const ONLINE_WINDOW_MS = { band: 15_000, room: 90_000 } as const;

interface DeviceLean {
  deviceId: string;
  name: string;
  fw: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
}

function toDto(d: DeviceLean) {
  const kind = deviceKindOf(d.deviceId);
  return {
    deviceId: d.deviceId,
    kind,
    name: d.name,
    fw: d.fw ?? null,
    online: d.lastSeenAt ? Date.now() - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS[kind] : false,
    lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
  };
}

devicesRouter.use(requireUser);

devicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const devices = await DeviceModel.find({ ownerId: req.user!.id })
      .sort({ createdAt: 1 })
      .lean();
    res.json(devices.map((d) => toDto(d as unknown as DeviceLean)));
  }),
);

/**
 * Claiming binds a physical node to an account and mints its ingest token.
 *
 * The plaintext token is returned exactly once - only its bcrypt hash is
 * stored. Losing it means re-claiming, which is the correct trade for a
 * credential that lives on a phone and a bench bridge.
 */
devicesRouter.post(
  '/claim',
  validateBody(claimDeviceSchema),
  asyncHandler(async (req, res) => {
    const { deviceId, name } = req.body as { deviceId: string; name?: string };

    const existing = await DeviceModel.findOne({ deviceId }).lean();
    if (existing && String(existing.ownerId) !== req.user!.id) {
      res.status(409).json({ error: 'already_claimed', detail: 'claimed by another account' });
      return;
    }

    const ingestToken = mintIngestToken(deviceId);
    const ingestTokenHash = await bcrypt.hash(ingestToken, 10);

    const device = await DeviceModel.findOneAndUpdate(
      { deviceId },
      {
        $set: { ownerId: req.user!.id, ingestTokenHash, name: name ?? deviceId },
        $setOnInsert: { deviceId },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    res.status(existing ? 200 : 201).json({
      device: toDto(device as unknown as DeviceLean),
      ingestToken,
    });
  }),
);

devicesRouter.get(
  '/:deviceId',
  requireOwnedDevice,
  asyncHandler(async (req, res) => {
    const device = await DeviceModel.findOne({ deviceId: req.params.deviceId }).lean();
    res.json(toDto(device as unknown as DeviceLean));
  }),
);

devicesRouter.get(
  '/:deviceId/latest',
  requireOwnedDevice,
  asyncHandler(async (req, res) => {
    const reading = await ReadingModel.findOne({ deviceId: req.params.deviceId })
      .sort({ recordedAt: -1, seq: -1 })
      .lean();
    if (!reading) {
      res.status(404).json({ error: 'no_data', detail: 'device has never reported' });
      return;
    }
    res.json(reading);
  }),
);

devicesRouter.get(
  '/:deviceId/readings',
  requireOwnedDevice,
  asyncHandler(async (req, res) => {
    const parsed = readingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }
    const { from, to, limit } = parsed.data;

    const filter: Record<string, unknown> = { deviceId: req.params.deviceId };
    if (from || to) {
      filter.recordedAt = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      };
    }

    // Newest-first from the index, then flipped so charts get chronological
    // data without a second sort on the client.
    const readings = await ReadingModel.find(filter).sort({ recordedAt: -1, seq: -1 }).limit(limit).lean();
    res.json(readings.reverse());
  }),
);

devicesRouter.get(
  '/:deviceId/events',
  requireOwnedDevice,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const events = await EventModel.find({ deviceId: req.params.deviceId })
      .sort({ recordedAt: -1, seq: -1 })
      .limit(limit)
      .lean();
    res.json(events);
  }),
);
