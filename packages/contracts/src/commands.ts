import { z } from 'zod';
import { motorPatternSchema } from './frames.js';

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
]);

export type BuzzCommand = z.infer<typeof buzzCommandSchema>;
export type Command = z.infer<typeof commandSchema>;
export type CommandName = Command['cmd'];

/** Serialise for the wire. The firmware reads one command per line. */
export function encodeCommand(command: Command): string {
  return JSON.stringify(command);
}
