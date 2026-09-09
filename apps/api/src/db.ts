import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDb(uri: string = env.MONGODB_URI): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  // Indexes are declared on the schemas; this makes sure they actually exist
  // before the first write, since the unique {deviceId, seq} index is what
  // ingest idempotency depends on.
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).syncIndexes()));
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
