import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  userId: number;
  email: string;
  handle: string;
}

export interface TokenResult {
  token: string;
  expiresIn: string;
}

export class JwtService {
  private static readonly ACCESS_TOKEN_EXPIRES_IN = '24h';
  private static readonly REFRESH_TOKEN_EXPIRES_IN = '7d';

  /**
   * Sign a JWT token with user payload
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
   * Sign a refresh token
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
   * Extract token from Authorization header
   */
  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7); // Remove 'Bearer ' prefix
  }
}
