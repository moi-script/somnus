import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { API_PREFIX } from '@lacs/contracts';
import { corsOrigins } from './env.js';
import { authRouter } from './routes/auth.js';
import { devicesRouter } from './routes/devices.js';
import { ingestRouter } from './routes/ingest.js';
import { commandsRouter } from './routes/commands.js';
import { streamRouter } from './routes/stream.js';
import { roomRouter } from './routes/room.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header at all: curl, the serial bridge, native HTTP from
        // the phone. Those are authenticated by token, not by origin.
        if (!origin || corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`origin not allowed: ${origin}`));
      },
      credentials: true,
    }),
  );

  // A 500-frame flush of ~300-byte frames is well under this.
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'lacs-api' });
  });

  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/devices`, roomRouter);
  app.use(`${API_PREFIX}/devices`, devicesRouter);
  app.use(`${API_PREFIX}/ingest`, ingestRouter);
  app.use(`${API_PREFIX}/stream`, streamRouter);
  app.use(API_PREFIX, commandsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err.message?.startsWith('origin not allowed')) {
      res.status(403).json({ error: 'cors_rejected', detail: err.message });
      return;
    }
    console.error('[api] unhandled error:', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
