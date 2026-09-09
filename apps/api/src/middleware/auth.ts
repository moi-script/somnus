import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../env.js';
import { DeviceModel } from '../models/index.js';

export interface AuthedUser {
  id: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      device?: { deviceId: string; ownerId: string };
    }
  }
}

export function signToken(user: AuthedUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * User auth. EventSource cannot set headers, so the SSE route also accepts
 * ?token= - which is why that route is read-only and scoped to one device.
 */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const token = bearer(req) ?? (typeof req.query.token === 'string' ? req.query.token : null);
  if (!token) {
    res.status(401).json({ error: 'unauthorized', detail: 'missing bearer token' });
    return;
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    req.user = { id: String(payload.sub), email: String(payload.email ?? '') };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized', detail: 'invalid or expired token' });
  }
}

/**
 * Ingest tokens are `<deviceId>.<48 random hex>`.
 *
 * The device id prefix means we look up exactly one document and bcrypt-compare
 * once, instead of scanning every device. The secret half is never stored, so a
 * database leak does not yield working device credentials.
 */
export function mintIngestToken(deviceId: string): string {
  return `${deviceId}.${crypto.randomBytes(24).toString('hex')}`;
}

export async function requireDevice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: 'unauthorized', detail: 'missing device token' });
    return;
  }

  const separator = token.indexOf('.');
  if (separator <= 0) {
    res.status(401).json({ error: 'unauthorized', detail: 'malformed device token' });
    return;
  }

  const deviceId = token.slice(0, separator);
  const device = await DeviceModel.findOne({ deviceId }).lean();
  if (!device || !(await bcrypt.compare(token, device.ingestTokenHash))) {
    res.status(401).json({ error: 'unauthorized', detail: 'unknown device token' });
    return;
  }

  req.device = { deviceId, ownerId: String(device.ownerId) };
  next();
}

/** Ownership check for every /devices/:deviceId route. */
export async function requireOwnedDevice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const deviceId = req.params.deviceId;
  const device = await DeviceModel.findOne({ deviceId, ownerId: req.user?.id }).lean();
  if (!device) {
    // 404 rather than 403: a device belonging to someone else should not be
    // distinguishable from one that does not exist.
    res.status(404).json({ error: 'not_found', detail: 'no such device' });
    return;
  }
  req.device = { deviceId: device.deviceId, ownerId: String(device.ownerId) };
  next();
}
