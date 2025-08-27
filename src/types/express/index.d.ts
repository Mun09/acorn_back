import express from 'express';

declare global {
  namespace Express {
    export interface Request {
      user?: {
        id: number;
        email: string;
        handle: string;
        bio: string | null;
        trustScore: number;
        verifiedFlags: any;
        firebaseUid: string | null;
        createdAt: Date;
        updatedAt: Date;
      };
    }
  }
}
