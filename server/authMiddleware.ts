import type { Request, Response, NextFunction } from 'express';
import {
  type AuthenticatedCoach,
  type CoachVerificationResult,
  verifySupabaseJwtAndCoach,
} from './supabaseAdmin.ts';

declare module 'express-serve-static-core' {
  interface Request {
    coach?: AuthenticatedCoach;
  }
}

export type CoachTokenVerifier = (accessToken: string) => Promise<CoachVerificationResult>;

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Requires a verified Supabase Bearer JWT and an active `owner_coach` profile.
 * Never trusts coach IDs, roles, or ownership fields from request body/query/headers.
 */
export function createRequireCoachAuth(verifier: CoachTokenVerifier = verifySupabaseJwtAndCoach) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        error: 'Authentication required: missing Bearer token.',
      });
      return;
    }

    try {
      const result = await verifier(token);
      if (!result.ok) {
        res.status(result.status).json({
          ok: false,
          code: result.status === 401 ? 'INVALID_OR_EXPIRED_SESSION' : 'FORBIDDEN_COACH',
          error: result.error,
        });
        return;
      }

      req.coach = result.coach;
      next();
    } catch {
      res.status(503).json({
        ok: false,
        code: 'AUTH_SERVICE_UNAVAILABLE',
        error: 'Authentication verification service unavailable.',
      });
    }
  };
}

/**
 * Optionally attaches `req.coach` when a valid Bearer token is present, without
 * failing anonymous calls (used only for redacted non-sensitive `/api/integrations/status`).
 */
export function createOptionalCoachAuth(verifier: CoachTokenVerifier = verifySupabaseJwtAndCoach) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      next();
      return;
    }

    try {
      const result = await verifier(token);
      if (result.ok) {
        req.coach = result.coach;
      }
    } catch {
      // Treat failed optional verification as unauthenticated
    }
    next();
  };
}
