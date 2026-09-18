import { Router } from 'express';
import {
  ackCommandSchema,
  commandFitsDevice,
  deviceKindOf,
  queueCommandSchema,
  type Command,
} from '@lacs/contracts';
import { CommandModel } from '../models/index.js';
import { requireDevice, requireOwnedDevice, requireUser } from '../middleware/auth.js';
import { asyncHandler, validateBody } from '../middleware/helpers.js';

export const commandsRouter = Router();

interface CommandLean {
  _id: unknown;
  deviceId: string;
  command: unknown;
  status: string;
  createdAt: Date;
  sentAt: Date | null;
  ackedAt: Date | null;
  ackDetail: string | null;
}

function toDto(c: CommandLean) {
  return {
    id: String(c._id),
    deviceId: c.deviceId,
    command: c.command,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    sentAt: c.sentAt ? c.sentAt.toISOString() : null,
    ackedAt: c.ackedAt ? c.ackedAt.toISOString() : null,
    ackDetail: c.ackDetail ?? null,
  };
}

/**
 * Queue a command from the dashboard.
 *
 * The server never talks to a device directly. A band's command waits here
 * until the phone drains it and writes it over BLE; the room unit drains its
 * own over WiFi.
 */
commandsRouter.post(
  '/devices/:deviceId/commands',
  requireUser,
  requireOwnedDevice,
  validateBody(queueCommandSchema),
  asyncHandler(async (req, res) => {
    const { command } = req.body as { command: Command };
    const kind = deviceKindOf(req.params.deviceId!);
    if (!commandFitsDevice(command, kind)) {
      res.status(400).json({
        error: 'wrong_device_kind',
        detail: `a ${kind} does not understand "${command.cmd}"`,
      });
      return;
    }
    const created = await CommandModel.create({
      deviceId: req.params.deviceId,
      ownerId: req.user!.id,
      command,
    });
    res.status(201).json(toDto(created.toObject() as unknown as CommandLean));
  }),
);

commandsRouter.get(
  '/devices/:deviceId/commands',
  requireUser,
  requireOwnedDevice,
  asyncHandler(async (req, res) => {
    const commands = await CommandModel.find({ deviceId: req.params.deviceId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(commands.map((c) => toDto(c as unknown as CommandLean)));
  }),
);

/**
 * The bridge drains this, authenticated as the device.
 *
 * Marking sent here rather than on ack means a command is delivered at most
 * once. For a vibration motor that is the right choice - a buzz that silently
 * repeats because a phone lost signal mid-write is worse than one that
 * quietly does not fire.
 */
commandsRouter.get(
  '/commands/pending',
  requireDevice,
  asyncHandler(async (req, res) => {
    const { deviceId } = req.device!;
    const pending = await CommandModel.find({ deviceId, status: 'pending' })
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();

    if (pending.length > 0) {
      await CommandModel.updateMany(
        { _id: { $in: pending.map((c) => c._id) } },
        { $set: { status: 'sent', sentAt: new Date() } },
      );
    }

    res.json(pending.map((c) => toDto(c as unknown as CommandLean)));
  }),
);

/** The bridge reports back what the firmware's ack frame said. */
commandsRouter.post(
  '/commands/:commandId/ack',
  requireDevice,
  validateBody(ackCommandSchema),
  asyncHandler(async (req, res) => {
    const { ok, detail } = req.body as { ok: boolean; detail?: string };
    const updated = await CommandModel.findOneAndUpdate(
      { _id: req.params.commandId, deviceId: req.device!.deviceId },
      {
        $set: {
          status: ok ? 'acked' : 'failed',
          ackedAt: new Date(),
          ackDetail: detail ?? null,
        },
      },
      { new: true },
    ).lean();

    if (!updated) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(toDto(updated as unknown as CommandLean));
  }),
);
