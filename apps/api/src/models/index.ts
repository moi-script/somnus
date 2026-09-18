import mongoose, { Schema, type InferSchemaType } from 'mongoose';

// --- users -----------------------------------------------------------------

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
);

export const UserModel = mongoose.model('User', userSchema);
export type UserDoc = InferSchemaType<typeof userSchema>;

// --- devices ---------------------------------------------------------------

const deviceSchema = new Schema(
  {
    deviceId: { type: String, required: true, unique: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    /** bcrypt hash - the plaintext ingest token is shown once, at claim time. */
    ingestTokenHash: { type: String, required: true },
    fw: { type: String, default: null },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const DeviceModel = mongoose.model('Device', deviceSchema);

// --- readings --------------------------------------------------------------

const readingSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    seq: { type: Number, required: true },
    /** Device uptime in ms. Not a timestamp - the node has no RTC. */
    deviceMs: { type: Number, required: true },
    recordedAt: { type: Date, required: true },
    ppg: { type: Schema.Types.Mixed, required: true },
    imu: { type: Schema.Types.Mixed, required: true },
    gsr: { type: Schema.Types.Mixed, required: true },
    /** Absent on v1 frames, which carried no step counter. */
    steps: { type: Schema.Types.Mixed, default: null },
    motor: { type: Schema.Types.Mixed, required: true },
    flags: { type: [String], default: [] },
  },
  { versionKey: false },
);

readingSchema.index({ deviceId: 1, recordedAt: -1 });
// Load-bearing: this is what makes ingest idempotent. A phone that dies
// mid-flush retries the whole batch and the duplicates bounce off here.
readingSchema.index({ deviceId: 1, seq: 1 }, { unique: true });

export const ReadingModel = mongoose.model('Reading', readingSchema);

// --- events ----------------------------------------------------------------

const eventSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    seq: { type: Number, required: true },
    deviceMs: { type: Number, required: true },
    recordedAt: { type: Date, required: true },
    kind: { type: String, required: true },
    value: { type: Number, required: true },
  },
  { versionKey: false },
);

eventSchema.index({ deviceId: 1, recordedAt: -1 });
eventSchema.index({ deviceId: 1, seq: 1 }, { unique: true });

export const EventModel = mongoose.model('Event', eventSchema);

// --- commands --------------------------------------------------------------

const commandSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    command: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'sent', 'acked', 'failed'],
      default: 'pending',
    },
    sentAt: { type: Date, default: null },
    ackedAt: { type: Date, default: null },
    ackDetail: { type: String, default: null },
  },
  { timestamps: true },
);

commandSchema.index({ deviceId: 1, status: 1, createdAt: 1 });

export const CommandModel = mongoose.model('Command', commandSchema);

// --- room frames -----------------------------------------------------------

/**
 * Presence and light frames from the room unit, in one collection since both
 * are replayed together to rebuild a night. `t` says which.
 */
const roomFrameSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    seq: { type: Number, required: true },
    deviceMs: { type: Number, required: true },
    recordedAt: { type: Date, required: true },
    t: { type: String, enum: ['presence', 'light'], required: true },
    /** presence frames only */
    present: { type: Boolean },
    /** light frames only: {on, mode, bright, temp, color} */
    state: { type: Schema.Types.Mixed },
    source: { type: String },
  },
  { versionKey: false },
);

roomFrameSchema.index({ deviceId: 1, t: 1, recordedAt: -1 });
// Same idempotency guarantee as readings: a replayed batch cannot duplicate.
roomFrameSchema.index({ deviceId: 1, seq: 1 }, { unique: true });

export const RoomFrameModel = mongoose.model('RoomFrame', roomFrameSchema);
