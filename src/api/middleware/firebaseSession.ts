import { Request, Response, NextFunction } from 'express';
import { admin } from '../../lib/firebaseAdmin';
import prisma from '../../lib/prisma';
import { logger } from '../../lib/logger';

const COOKIE_NAME = process.env['SESSION_COOKIE_NAME'] ?? 'acorn_session';

// Bearer <ID_TOKEN> 형식의 Firebase ID 토큰을 검증하고
// 로컬 DB(User)를 firebaseUid/email 기준으로 upsert
export async function authenticateSession(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const sessionCookie = req.cookies?.[COOKIE_NAME];
    if (!sessionCookie) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No session cookie',
        statusCode: 401,
      });
    }
    const decoded = await admin.auth().verifySessionCookie(sessionCookie, true);
    const firebaseUid = decoded.uid;
    const user = await prisma.user.findUnique({ where: { firebaseUid } });

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not found',
        statusCode: 401,
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    logger.error('Session auth error:', error);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid/expired session',
      statusCode: 401,
    });
  }
}
