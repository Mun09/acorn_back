import { Router, Request, Response } from 'express';
import { admin } from '../../lib/firebaseAdmin';
import { asyncHandler } from '../middleware/error';
import { authRateLimit, highFrequencyRateLimit } from '../middleware/rateLimit';
import { authenticateSession } from '../middleware/firebaseSession';
import prisma from '../../lib/prisma';

const router: Router = Router();
const COOKIE_NAME = process.env['SESSION_COOKIE_NAME'] ?? 'acorn_session';
const IS_PROD = process.env['NODE_ENV'] === 'production';

/**
 * POST /auth/session-cookie
 * body: { idToken: string }
 * 로그인 직후 프론트가 보낸 idToken으로 서버가 세션 쿠키 생성
 */
router.post(
  '/session-cookie',
  authRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    // 최대 14일(밀리초)까지 가능. 현재는 7일
    const expiresIn = 7 * 24 * 60 * 60 * 1000;

    const sessionCookie = await admin
      .auth()
      .createSessionCookie(idToken, { expiresIn });

    res.cookie(COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: IS_PROD, // 로컬 http 개발 시 false
      sameSite: 'strict',
      path: '/',
      maxAge: expiresIn,
    });

    return res.status(200).json({ message: 'Session created' });
  })
);

/**
 * GET /auth/me  (보호 라우트)
 */
router.get(
  '/me',
  highFrequencyRateLimit,
  authenticateSession,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    res.json({
      message: 'User information retrieved successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          handle: user.handle,
          bio: user.bio,
          trustScore: user.trustScore,
          verifiedFlags: user.verifiedFlags,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      },
    });
  })
);

router.post(
  '/signup',
  asyncHandler(async (req: Request, res: Response) => {
    const { idToken, handle } = req.body;

    if (!idToken || !handle) {
      return res.status(400).json({ error: 'idToken and handle are required' });
    }

    try {
      // 1) Firebase ID 토큰 검증
      const decoded = await admin.auth().verifyIdToken(idToken);
      const firebaseUid = decoded.uid;
      const email = decoded.email ?? '';

      // 2) DB 중복 체크
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ firebaseUid }, { email }, { handle }],
        },
      });
      if (existingUser) {
        return res
          .status(409)
          .json({ error: 'Email, UID or handle already in use' });
      }

      // 3) User 생성
      const user = await prisma.user.create({
        data: {
          firebaseUid,
          email,
          handle,
          bio: null,
          trustScore: 0,
          verifiedFlags: null as any,
        },
        select: {
          id: true,
          email: true,
          handle: true,
          bio: true,
          trustScore: true,
          verifiedFlags: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // 4) 성공 응답
      return res.status(201).json({
        message: 'User created successfully',
        data: { user },
      });
    } catch (e) {
      console.error(e);
      return res.status(401).json({ error: 'Invalid Firebase ID token' });
    }
  })
);

/**
 * POST /auth/logout
 * 쿠키 삭제 (클라 signOut()과 병행 권장)
 */
router.post(
  '/logout',
  highFrequencyRateLimit,
  asyncHandler(async (_req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'strict',
      path: '/',
    });
    res.status(200).json({ message: 'Logged out' });
  })
);

/**
 * POST /auth/logout-all
 * 모든 기기 세션 무효화 + 로컬 쿠키 제거
 */
router.post(
  '/logout-all',
  authRateLimit,
  authenticateSession,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    await admin.auth().revokeRefreshTokens(user.firebaseUid!);
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'strict',
      path: '/',
    });
    res
      .status(200)
      .json({ message: 'Logged out from all devices successfully' });
  })
);

export { router as authRouter };
