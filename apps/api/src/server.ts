import { createApp } from './app.js';
import { connectDb, disconnectDb } from './db.js';
import { env } from './env.js';

async function main(): Promise<void> {
  await connectDb();
  console.log(`[api] mongo connected: ${env.MONGODB_URI}`);

  const server = createApp().listen(env.API_PORT, () => {
    console.log(`[api] listening on http://localhost:${env.API_PORT}`);
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
