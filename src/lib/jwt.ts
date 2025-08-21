import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from './prisma';

export interface JwtPayload {
  userId: number;
  email: string;
  handle: string;
}

export interface RefreshTokenPayload {
  userId: number;
  tokenId: string;
}

export interface TokenResult {
  token: string;
  expiresIn: string;
}

export interface AuthTokens {
  accessToken: TokenResult;
  refreshToken: TokenResult;
}

export class JwtService {
  private static readonly ACCESS_TOKEN_EXPIRES_IN = '15m'; // Shorter for better security
  private static readonly REFRESH_TOKEN_EXPIRES_IN = '7d';

  /**
   * Generate both access and refresh tokens for a user
   */
  static async generateTokens(user: {
    id: number;
    email: string;
    handle: string;
  }): Promise<AuthTokens> {
    // Generate access token
    const accessToken = this.signAccessToken({
      userId: user.id,
      email: user.email,
      handle: user.handle,
    });

    // Generate refresh token with unique ID
    const tokenId = this.generateTokenId();
    const refreshTokenPayload: RefreshTokenPayload = {
      userId: user.id,
      tokenId,
    };

    const refreshToken = this.signRefreshTokenWithPayload(refreshTokenPayload);

    // Store refresh token in database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    await prisma.refreshToken.create({
      data: {
        token: tokenId,
        userId: user.id,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Sign a JWT access token with user payload
   */
  static signAccessToken(payload: JwtPayload): TokenResult {
    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: this.ACCESS_TOKEN_EXPIRES_IN,
      issuer: 'acorn-api',
      audience: 'acorn-client',
    });

    return {
      token,
      expiresIn: this.ACCESS_TOKEN_EXPIRES_IN,
    };
  }

  /**
   * Sign a refresh token (deprecated - use generateTokens instead)
   */
  static signRefreshToken(payload: Pick<JwtPayload, 'userId'>): TokenResult {
    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: this.REFRESH_TOKEN_EXPIRES_IN,
      issuer: 'acorn-api',
      audience: 'acorn-client',
    });

    return {
      token,
      expiresIn: this.REFRESH_TOKEN_EXPIRES_IN,
    };
  }

  /**
   * Sign a refresh token with full payload including tokenId
   */
  private static signRefreshTokenWithPayload(
    payload: RefreshTokenPayload
  ): TokenResult {
    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: this.REFRESH_TOKEN_EXPIRES_IN,
      issuer: 'acorn-api',
      audience: 'acorn-client',
    });

    return {
      token,
      expiresIn: this.REFRESH_TOKEN_EXPIRES_IN,
    };
  }

  /**
   * Verify and decode JWT token
   */
  static verifyToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, {
        issuer: 'acorn-api',
        audience: 'acorn-client',
      }) as JwtPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token');
      }
      throw new Error('Token verification failed');
    }
  }

  /**
   * Verify and decode refresh token
   */
  static verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, {
        issuer: 'acorn-api',
        audience: 'acorn-client',
      }) as RefreshTokenPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Refresh token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid refresh token');
      }
      throw new Error('Refresh token verification failed');
    }
  }

  /**
   * Refresh access token using refresh token
   */
  static async refreshAccessToken(refreshToken: string): Promise<TokenResult> {
    // Verify refresh token
    const decoded = this.verifyRefreshToken(refreshToken);

    // Check if refresh token exists in database and is not expired
    const storedToken = await prisma.refreshToken.findFirst({
      where: {
        token: decoded.tokenId,
        userId: decoded.userId,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
    });

    if (!storedToken) {
      throw new Error('Invalid or expired refresh token');
    }

    // Generate new access token
    return this.signAccessToken({
      userId: storedToken.user.id,
      email: storedToken.user.email,
      handle: storedToken.user.handle,
    });
  }

  /**
   * Revoke refresh token
   */
  static async revokeRefreshToken(refreshToken: string): Promise<void> {
    try {
      const decoded = this.verifyRefreshToken(refreshToken);

      await prisma.refreshToken.deleteMany({
        where: {
          token: decoded.tokenId,
          userId: decoded.userId,
        },
      });
    } catch (error) {
      // Token might be invalid, but we still want to attempt cleanup
      console.warn('Failed to revoke refresh token:', error);
    }
  }

  /**
   * Revoke all refresh tokens for a user
   */
  static async revokeAllRefreshTokens(userId: number): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: {
        userId,
      },
    });
  }

  /**
   * Clean up expired refresh tokens
   */
  static async cleanupExpiredTokens(): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }

  /**
   * Generate a unique token ID
   */
  private static generateTokenId(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }

  /**
   * Extract token from Authorization header
   */
  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7); // Remove 'Bearer ' prefix
  }
}
