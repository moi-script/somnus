import { z } from 'zod';
import { lightColorSchema, motorPatternSchema } from './frames.js';
import type { DeviceKind } from './devices.js';

/**
 * Commands travelling device-ward. The firmware's parseCommand() in
 * payload.cpp accepts exactly these shapes, one JSON object per line, over
 * whichever Transport delivered them.
 */

export const buzzCommandSchema = z.object({
  cmd: z.literal('buzz'),
  /** Defaults to "single" in firmware when omitted. */
  pattern: motorPatternSchema.exclude(['idle']).optional(),
  /** Stretches the on-steps of the pattern. 0 or absent keeps pattern timing. */
  ms: z.number().int().min(0).max(5000).optional(),
});

export const configCommandSchema = z
  .object({
    cmd: z.literal('config'),
    /** Telemetry rate. Firmware clamps to 1..20 and ignores anything else. */
    hz: z.number().int().min(1).max(20).optional(),
    /** Raw ADC counts above baseline that count as a GSR spike. */
    gsrThresh: z.number().int().min(0).max(4095).optional(),
  })
  .refine((c) => c.hz !== undefined || c.gsrThresh !== undefined, {
    message: 'config needs at least one of hz or gsrThresh',
  });

export const statusCommandSchema = z.object({ cmd: z.literal('status') });
export const calibrateCommandSchema = z.object({ cmd: z.literal('calibrate') });
export const humanCommandSchema = z.object({
  cmd: z.literal('human'),
  on: z.boolean(),
});

/**
 * Room unit: change the bulb. Any mix of `on`, white settings (`bright`,
 * `temp`) or a `color` - but never white settings and a colour together,
 * since the bulb is in one mode or the other. See lightCommandProblem().
 */
export const lightCommandSchema = z.object({
  cmd: z.literal('light'),
  on: z.boolean().optional(),
  bright: z.number().int().min(1).max(100).optional(),
  temp: z.number().int().min(0).max(100).optional(),
  color: lightColorSchema.optional(),
});

/** Room unit: let the radar switch the light, or stop it. */
export const autoCommandSchema = z.object({
  cmd: z.literal('auto'),
  on: z.boolean(),
});

export const commandSchema = z.discriminatedUnion('cmd', [
  buzzCommandSchema,
  z.object({
    cmd: z.literal('config'),
    hz: z.number().int().min(1).max(20).optional(),
    gsrThresh: z.number().int().min(0).max(4095).optional(),
  }),
  statusCommandSchema,
  calibrateCommandSchema,
  humanCommandSchema,
  lightCommandSchema,
  autoCommandSchema,
]);

export type BuzzCommand = z.infer<typeof buzzCommandSchema>;
export type LightCommand = z.infer<typeof lightCommandSchema>;
export type Command = z.infer<typeof commandSchema>;
export type CommandName = Command['cmd'];

/** Serialise for the wire. The firmware reads one command per line. */
export function encodeCommand(command: Command): string {
  return JSON.stringify(command);
}

const COMMANDS_BY_KIND: Record<DeviceKind, readonly string[]> = {
  band: ['buzz', 'config', 'status', 'calibrate', 'human'],
  room: ['light', 'auto', 'status'],
};

/** A buzz queued for a radar would sit in the queue and fail on arrival. */
export function commandFitsDevice(command: Command, kind: DeviceKind): boolean {
  return COMMANDS_BY_KIND[kind].includes(command.cmd);
}

/**
 * Rules a light command must meet beyond its shape. Kept out of the schema
 * because a refined schema cannot sit inside a discriminated union.
 */
export function lightCommandProblem(command: Command): string | null {
  if (command.cmd !== 'light') return null;
  const white = command.bright !== undefined || command.temp !== undefined;
  const colour = command.color !== undefined;
  if (!white && !colour && command.on === undefined) {
    return 'light needs at least one of on, bright, temp or color';
  }
  if (white && colour) return 'light takes either bright/temp or color, not both';
  return null;
}
