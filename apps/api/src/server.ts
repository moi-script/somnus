import { createApp } from './app.js';
import { connectDb, disconnectDb } from './db.js';
import { env, port, redactedMongoUri } from './env.js';

async function main(): Promise<void> {
  await connectDb();
  // Hosted databases carry a password in the URI; keep it out of the logs.
  console.log(`[api] mongo connected: ${redactedMongoUri(env.MONGODB_URI)}`);

  const server = createApp().listen(port, () => {
    console.log(`[api] listening on port ${port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal}, shutting down`);
    server.close();
    await disconnectDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
