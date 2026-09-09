import { z } from 'zod';

/**
 * The wire format emitted by the XIAO ESP32-C3 firmware.
 *
 * This file is the single definition of that format. The firmware's
 * payload.cpp is the other half of the contract; when one changes, this
 * changes, PAYLOAD_VERSION goes up, and TypeScript points at every consumer
 * that needs attention.
 */
export const PAYLOAD_VERSION = 2;

/**
 * Versions still accepted on the wire.
 *
 * Fields added in v2 are optional, so a v1 device and a v2 device can report
 * side by side and a phone holding frames buffered before an update can still
 * flush them. Anything absent shows in the app as not measured, which is the
 * truth.
 */
export const SUPPORTED_PAYLOAD_VERSIONS = [1, 2] as const;

/** Fires when a local rule on the device trips. */
export const flagSchema = z.enum(['fall', 'gsr_spike', 'no_finger']);
export type Flag = z.infer<typeof flagSchema>;

export const motorPatternSchema = z.enum(['idle', 'single', 'double', 'long', 'sos']);
export type MotorPattern = z.infer<typeof motorPatternSchema>;

/**
 * Present on every frame.
 *
 * `ms` is device uptime, not wall clock - the device has no RTC. Never treat
 * it as a timestamp; the server assigns `recordedAt` on arrival. It is only
 * good for ordering within one uninterrupted power session.
 *
 * `seq` increments across all frame types, so a gap means a dropped frame.
 */
const envelope = {
  v: z.union([z.literal(1), z.literal(2)]),
  id: z.string().min(1).max(32),
  seq: z.number().int().nonnegative(),
  ms: z.number().int().nonnegative(),
};

export const ppgSchema = z.object({
  ok: z.boolean(),
  /** IR level cleared the finger-present threshold (50000 in firmware). */
  finger: z.boolean(),
  ir: z.number().int().nonnegative(),
  red: z.number().int().nonnegative(),
  /** Instantaneous, from the last beat interval. 0 when no finger. */
  bpm: z.number().nonnegative(),
  /** Mean of the last 4 beats. 0 until 4 beats have been seen. */
  bpmAvg: z.number().int().nonnegative(),

  /**
   * Blood oxygen percentage, computed on the device (v2 and later).
   *
   * -1 means the algorithm rejected the window. Always read `spo2Valid`
   * first: a percentage the algorithm did not stand behind must never reach
   * a screen.
   */
  spo2: z.number().int().min(-1).max(100).optional(),
  spo2Valid: z.boolean().optional(),
});

/** Step counting, added in v2. */
export const stepsSchema = z.object({
  /** Since the device last powered on, not since midnight. */
  count: z.number().int().nonnegative(),
  /** Steps per minute while walking, 0 when still. */
  cadence: z.number().int().min(0).max(300),
});

export const imuSchema = z.object({
  ok: z.boolean(),
  ax: z.number(),
  ay: z.number(),
  az: z.number(),
  gx: z.number(),
  gy: z.number(),
  gz: z.number(),
  /** Magnitude of the acceleration vector, in g. ~1.0 at rest. */
  mag: z.number().nonnegative(),
  tempC: z.number(),
});

export const gsrSchema = z.object({
  ok: z.boolean(),
  /** 12-bit ADC, 0..4095. */
  raw: z.number().int().min(0).max(4095),
  volt: z.number().nonnegative(),
  /** Slow rolling baseline the firmware compares against for spikes. */
  base: z.number().int().min(0).max(4095),
});

export const telemetryFrameSchema = z.object({
  ...envelope,
  t: z.literal('telemetry'),
  ppg: ppgSchema,
  imu: imuSchema,
  gsr: gsrSchema,
  /**
   * Absent on v1 frames. Null once stored, because Mongo keeps the key with a
   * null rather than dropping it; both mean the same thing, so both are
   * accepted and callers only ever check for a value.
   */
  steps: stepsSchema.nullish(),
  motor: z.object({ on: z.boolean(), pattern: motorPatternSchema }),
  flags: z.array(flagSchema),
});

export const statusFrameSchema = z.object({
  ...envelope,
  t: z.literal('status'),
  fw: z.string(),
  transport: z.string(),
  online: z.number().int().min(0),
  total: z.number().int().min(0),
  sensors: z.object({
    max30102: z.boolean(),
    mpu6050: z.boolean(),
    gsr: z.boolean(),
  }),
  config: z.object({
    hz: z.number().int().min(1).max(20),
    gsrDelta: z.number().int().nonnegative(),
    fallHighG: z.number(),
    freeFallG: z.number(),
    fingerLostMs: z.number().int().nonnegative(),
    human: z.boolean(),
  }),
});

export const eventFrameSchema = z.object({
  ...envelope,
  t: z.literal('event'),
  kind: flagSchema,
  value: z.number(),
});

export const ackFrameSchema = z.object({
  ...envelope,
  t: z.literal('ack'),
  cmd: z.string(),
  ok: z.boolean(),
  /** Firmware omits this field entirely when it has nothing to say. */
  detail: z.string().optional(),
});

export const frameSchema = z.discriminatedUnion('t', [
  telemetryFrameSchema,
  statusFrameSchema,
  eventFrameSchema,
  ackFrameSchema,
]);

export type PpgData = z.infer<typeof ppgSchema>;
export type ImuData = z.infer<typeof imuSchema>;
export type GsrData = z.infer<typeof gsrSchema>;
export type StepData = z.infer<typeof stepsSchema>;
export type TelemetryFrame = z.infer<typeof telemetryFrameSchema>;
export type StatusFrame = z.infer<typeof statusFrameSchema>;
export type EventFrame = z.infer<typeof eventFrameSchema>;
export type AckFrame = z.infer<typeof ackFrameSchema>;
export type Frame = z.infer<typeof frameSchema>;
export type FrameType = Frame['t'];
