import { clerkMiddleware, requireAuth, getAuth, AuthObject } from '@clerk/express';
import { Request, Response, NextFunction } from 'express';
import { ChatRepository } from '../repositories/types';

// Extend Express Request to include our user context
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      clerkAuth?: AuthObject;
    }
  }
}

// Base Clerk middleware - verifies JWT and populates req.auth
export const clerkAuthMiddleware = clerkMiddleware();

// Middleware to require authentication
export const requireAuthentication = requireAuth();

// Middleware to sync Clerk user to database and attach internal userId to request
export function syncUserMiddleware(repo: ChatRepository) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return next();
    }

    try {
      // Sync user to database and get internal user ID
      const user = await repo.upsertUserFromClerk({
        clerkId: auth.userId,
        email: auth.sessionClaims?.email as string | undefined,
        firstName: auth.sessionClaims?.first_name as string | undefined,
        lastName: auth.sessionClaims?.last_name as string | undefined,
        imageUrl: auth.sessionClaims?.image_url as string | undefined,
      });
      
      // Attach internal userId to request for use in route handlers
      req.userId = user.id;
      req.clerkAuth = auth;
      
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Helper to get userId from request (throws if not authenticated)
export function getUserId(req: Request): string {
  if (!req.userId) {
    throw new Error('User not authenticated');
  }
  return req.userId;
}
