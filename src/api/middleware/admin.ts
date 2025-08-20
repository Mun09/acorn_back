/**
 * Admin authorization middleware
 * Ensures user has admin privileges
 */
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to check if user has admin privileges
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Mock admin check - in real implementation, check user.role from database
  const userRole = (req.user as any).role || 'USER';

  if (userRole !== 'ADMIN') {
    res.status(403).json({
      error: 'Admin privileges required',
      userRole,
    });
    return;
  }

  next();
}

/**
 * Middleware to check if user has moderator or admin privileges
 */
export function requireModerator(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Mock moderator check - in real implementation, check user.role from database
  const userRole = (req.user as any).role || 'USER';

  if (userRole !== 'ADMIN' && userRole !== 'MODERATOR') {
    res.status(403).json({
      error: 'Moderator or admin privileges required',
      userRole,
    });
    return;
  }

  next();
}
