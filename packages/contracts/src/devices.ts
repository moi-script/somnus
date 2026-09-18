import { z } from 'zod';

/**
 * Device ids are minted by firmware from the eFuse MAC. The prefix says what
 * kind of hardware it is: `lacs-7a3f21` is a band, `room-7c1a02` is the
 * bedside radar and bulb unit.
 */
export const deviceIdSchema = z
  .string()
  .regex(/^(lacs|room)-[0-9a-f]{6}$/, 'expected a device id like lacs-7a3f21 or room-7c1a02');

export const deviceKindSchema = z.enum(['band', 'room']);
export type DeviceKind = z.infer<typeof deviceKindSchema>;

/** Derived rather than stored, so the id alone always tells you the kind. */
export function deviceKindOf(deviceId: string): DeviceKind {
  return deviceId.startsWith('room-') ? 'room' : 'band';
}
