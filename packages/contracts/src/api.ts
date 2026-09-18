import { z } from 'zod';
import { commandSchema, lightCommandProblem } from './commands.js';
import { deviceIdSchema, deviceKindSchema } from './devices.js';
import { eventFrameSchema, frameSchema, telemetryFrameSchema } from './frames.js';

export const API_PREFIX = '/api/v1';

/** Shape of every 4xx/5xx body, so clients have one error path. */
export const apiErrorSchema = z.object({
  error: z.string(),
  detail: z.string().optional(),
  issues: z.array(z.string()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// --- auth ------------------------------------------------------------------

export const credentialsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
});

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
});

export const authResponseSchema = z.object({
  token: z.string(),
  user: userSchema,
});

export type Credentials = z.infer<typeof credentialsSchema>;
export type User = z.infer<typeof userSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;

// --- devices ---------------------------------------------------------------

export const claimDeviceSchema = z.object({
  deviceId: deviceIdSchema,
  name: z.string().min(1).max(60).optional(),
});

export const deviceSchema = z.object({
  deviceId: deviceIdSchema,
  kind: deviceKindSchema,
  name: z.string(),
  fw: z.string().nullable(),
  online: z.boolean(),
  lastSeenAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

/**
 * Returned once, at claim time. The bridge and the phone authenticate with
 * this instead of a user JWT, so a token pulled off a device can only write
 * that device's frames - it can never read anyone's history.
 */
export const claimResponseSchema = z.object({
  device: deviceSchema,
  ingestToken: z.string(),
});

export type Device = z.infer<typeof deviceSchema>;
export type ClaimResponse = z.infer<typeof claimResponseSchema>;

// --- ingest ----------------------------------------------------------------

/**
 * Batched because the phone buffers offline and flushes on reconnect. Capped
 * at 500 so one flush cannot produce an unbounded write.
 */
export const ingestRequestSchema = z.object({
  frames: z.array(frameSchema).min(1).max(500),
});

export const ingestResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  /** Already stored. Not an error - this is what makes retries safe. */
  duplicates: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});

export type IngestRequest = z.infer<typeof ingestRequestSchema>;
export type IngestResponse = z.infer<typeof ingestResponseSchema>;

// --- readings & events -----------------------------------------------------

export const readingsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export const readingSchema = telemetryFrameSchema.extend({
  recordedAt: z.string().datetime(),
});

export const storedEventSchema = eventFrameSchema.extend({
  recordedAt: z.string().datetime(),
});

export type Reading = z.infer<typeof readingSchema>;
export type StoredEvent = z.infer<typeof storedEventSchema>;

// --- commands --------------------------------------------------------------

export const queueCommandSchema = z.object({ command: commandSchema }).superRefine((body, ctx) => {
  const problem = lightCommandProblem(body.command);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['command'], message: problem });
});

export const commandStatusSchema = z.enum(['pending', 'sent', 'acked', 'failed']);

export const queuedCommandSchema = z.object({
  id: z.string(),
  deviceId: deviceIdSchema,
  command: commandSchema,
  status: commandStatusSchema,
  createdAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
  ackedAt: z.string().datetime().nullable(),
  ackDetail: z.string().nullable(),
});

export const ackCommandSchema = z.object({
  ok: z.boolean(),
  detail: z.string().max(200).optional(),
});

export type QueuedCommand = z.infer<typeof queuedCommandSchema>;
export type CommandStatus = z.infer<typeof commandStatusSchema>;

// --- SSE -------------------------------------------------------------------

/** Event names on GET /stream/:deviceId. */
export const SSE_EVENTS = {
  telemetry: 'telemetry',
  event: 'event',
  status: 'status',
  ack: 'ack',
  presence: 'presence',
  light: 'light',
  /** Comment-only keepalive so proxies do not close an idle stream. */
  ping: 'ping',
} as const;
