import { Router } from 'express';
import { requireOwnedDevice, requireUser } from '../middleware/auth.js';
import { frameBus } from '../bus.js';

export const streamRouter = Router();

/** Proxies and phone radios drop silent connections; this keeps them open. */
const KEEPALIVE_MS = 20_000;

/**
 * GET /stream/:deviceId - Server-Sent Events.
 *
 * SSE rather than WebSockets: the dashboard feed is one-directional and
 * EventSource reconnects on its own. Commands travel by ordinary POST, so
 * there is nothing a duplex socket would buy here.
 *
 * EventSource cannot set an Authorization header, so requireUser also accepts
 * ?token=. That is why this route is read-only and device-scoped.
 */
streamRouter.get('/:deviceId', requireUser, requireOwnedDevice, (req, res) => {
  // requireOwnedDevice has already resolved and authorised this.
  const { deviceId } = req.device!;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Without this, nginx and friends buffer the stream into uselessness.
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n\n`);
  res.write(`: connected to ${deviceId}\n\n`);

  const unsubscribe = frameBus.subscribe(deviceId, (frame) => {
    res.write(`event: ${frame.t}\n`);
    res.write(`id: ${frame.seq}\n`);
    res.write(`data: ${JSON.stringify(frame)}\n\n`);
  });

  const keepalive = setInterval(() => res.write(`: ping\n\n`), KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(keepalive);
    unsubscribe();
    res.end();
  });
});
