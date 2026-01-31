import type { Request, Response, NextFunction } from 'express';
import { ChatRepository } from '../repositories/types';

export const DEFAULT_LOCAL_USER_KEY = 'local-user';

// Extend Express Request to include our user context
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function localUserMiddleware(
  repo: ChatRepository,
  localUserKey: string = DEFAULT_LOCAL_USER_KEY,
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = await repo.getOrCreateLocalUser(localUserKey);
      req.userId = user.id;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getUserId(req: Request): string {
  if (!req.userId) {
    throw new Error('Local user not initialized');
  }
  return req.userId;
}
