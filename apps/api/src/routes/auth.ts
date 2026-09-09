import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { credentialsSchema } from '@lacs/contracts';
import { UserModel } from '../models/index.js';
import { requireUser, signToken } from '../middleware/auth.js';
import { asyncHandler, validateBody } from '../middleware/helpers.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  validateBody(credentialsSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };

    const existing = await UserModel.findOne({ email: email.toLowerCase() }).lean();
    if (existing) {
      res.status(409).json({ error: 'email_taken' });
      return;
    }

    const user = await UserModel.create({
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
    });

    res.status(201).json({
      token: signToken({ id: String(user._id), email: user.email }),
      user: {
        id: String(user._id),
        email: user.email,
        createdAt: user.createdAt.toISOString(),
      },
    });
  }),
);

authRouter.post(
  '/login',
  validateBody(credentialsSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };

    const user = await UserModel.findOne({ email: email.toLowerCase() });
    // Same response whether the email is unknown or the password is wrong, so
    // this endpoint cannot be used to enumerate accounts.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    res.json({
      token: signToken({ id: String(user._id), email: user.email }),
      user: {
        id: String(user._id),
        email: user.email,
        createdAt: user.createdAt.toISOString(),
      },
    });
  }),
);

authRouter.get(
  '/me',
  requireUser,
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.user!.id).lean();
    if (!user) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({
      id: String(user._id),
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    });
  }),
);
