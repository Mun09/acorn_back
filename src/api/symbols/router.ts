import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';

const router: Router = Router();
const prisma = new PrismaClient();

// 간단한 요청 검증 함수
const validateQuery = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: Function) => {
    try {
      schema.parse(req.query);
      next();
    } catch (error) {
      res.status(400).json({
        success: false,
        error: 'Invalid request parameters',
      });
    }
  };
};

// 심볼 검색 스키마
const searchSymbolsSchema = z.object({
  query: z.string().min(1).max(10).optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

// 심볼별 포스트 조회 스키마
const getSymbolPostsSchema = z.object({
  sort: z.enum(['latest', 'hot']).default('latest'),
  limit: z.coerce.number().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

// 심볼 검색
router.get(
  '/search',
  validateQuery(searchSymbolsSchema),
  async (req: Request, res: Response) => {
    try {
      const { query, limit, cursor } = req.query as any;

      const whereClause: any = {};

      if (query) {
        whereClause.ticker = {
          contains: query.toUpperCase(),
          mode: 'insensitive',
        };
      }

      if (cursor) {
        whereClause.id = {
          lt: parseInt(cursor),
        };
      }

      const symbols = await prisma.symbol.findMany({
        where: whereClause,
        orderBy: {
          id: 'desc',
        },
        take: parseInt(limit) || 20,
        include: {
          _count: {
            select: {
              posts: true,
            },
          },
        },
      });

      const nextCursor =
        symbols.length === limit && symbols.length > 0
          ? symbols[symbols.length - 1]?.id.toString()
          : null;

      res.json({
        success: true,
        data: {
          symbols,
          nextCursor,
        },
      });
    } catch (error) {
      console.error('Search symbols error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search symbols',
      });
    }
  }
);

// 심볼 피드 조회 (모든 심볼 포스트)
router.get(
  '/feed',
  validateQuery(getSymbolPostsSchema),
  asyncHandler(async (req, res) => {
    try {
      const { sort, limit, cursor } = req.query as any;

      const whereClause: any = {
        symbols: {
          some: {}, // 심볼이 있는 모든 포스트
        },
      };

      if (cursor) {
        whereClause.id = {
          lt: parseInt(cursor),
        };
      }

      let orderBy: any = { id: 'desc' }; // latest

      if (sort === 'hot') {
        // 핫 정렬: 최근 24시간 내 반응이 많은 순
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        whereClause.createdAt = {
          gte: oneDayAgo,
        };
        orderBy = [
          {
            reactions: {
              _count: 'desc',
            },
          },
          { id: 'desc' },
        ];
      }

      const posts = await prisma.post.findMany({
        where: whereClause,
        orderBy,
        take: parseInt(limit) || 20,
        include: {
          user: {
            select: {
              id: true,
              handle: true,
              email: true,
            },
          },
          symbols: {
            include: {
              symbol: true,
            },
          },
          reactions: {
            select: {
              type: true,
            },
          },
          _count: {
            select: {
              reactions: true,
              replies: true,
            },
          },
        },
      });

      // 반응 카운트 계산
      const postsWithCounts = posts.map(post => {
        const reactionCounts = post.reactions.reduce(
          (acc: Record<string, number>, reaction: any) => {
            acc[reaction.type] = (acc[reaction.type] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

        return {
          ...post,
          author: post.user, // user를 author로 매핑
          reactionCounts,
          reactions: undefined, // 원본 reactions 제거
          user: undefined, // 원본 user 제거
        };
      });

      const nextCursor =
        posts.length === limit && posts.length > 0
          ? posts[posts.length - 1]?.id.toString()
          : null;

      return res.json({
        success: true,
        data: {
          posts: postsWithCounts,
          nextCursor,
        },
      });
    } catch (error) {
      console.error('Get symbol feed error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get symbol feed',
      });
    }
  })
);

// 특정 심볼의 포스트 조회
router.get(
  '/:ticker/posts',
  validateQuery(getSymbolPostsSchema),
  asyncHandler(async (req, res) => {
    try {
      const { ticker } = req.params;
      if (!ticker) {
        res.status(400).json({
          success: false,
          error: 'Ticker is required',
        });
        return;
      }

      const { sort, limit, cursor } = req.query as any;

      // 심볼이 존재하는지 확인 (기본 exchange는 NASDAQ으로 가정)
      const symbol = await prisma.symbol.findFirst({
        where: {
          ticker: ticker.toUpperCase(),
        },
      });

      if (!symbol) {
        return res.status(404).json({
          success: false,
          error: 'Symbol not found',
        });
      }

      const whereClause: any = {
        symbols: {
          some: {
            symbolId: symbol.id,
          },
        },
      };

      if (cursor) {
        whereClause.id = {
          lt: parseInt(cursor),
        };
      }

      let orderBy: any = { id: 'desc' }; // latest

      if (sort === 'hot') {
        // 핫 정렬: 최근 24시간 내 반응이 많은 순
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        whereClause.createdAt = {
          gte: oneDayAgo,
        };

        orderBy = [{ reactions: { _count: 'desc' } }, { createdAt: 'desc' }];
      }

      const posts = await prisma.post.findMany({
        where: whereClause,
        orderBy,
        take: parseInt(limit) || 20,
        include: {
          user: {
            select: {
              id: true,
              handle: true,
              email: true,
            },
          },
          symbols: {
            include: {
              symbol: true,
            },
          },
          reactions: {
            select: {
              type: true,
            },
          },
          _count: {
            select: {
              reactions: true,
              replies: true,
            },
          },
        },
      });

      // 반응 수 계산
      const postsWithCounts = posts.map((post: any) => {
        const reactionCounts = post.reactions.reduce(
          (acc: any, reaction: any) => {
            acc[reaction.type] = (acc[reaction.type] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

        return {
          ...post,
          author: post.user, // user를 author로 매핑
          reactionCounts,
          reactions: undefined, // 원본 reactions 제거
        };
      });

      const nextCursor =
        posts.length === limit && posts.length > 0
          ? posts[posts.length - 1]?.id.toString()
          : null;

      return res.json({
        success: true,
        data: {
          symbol,
          posts: postsWithCounts,
          nextCursor,
        },
      });
    } catch (error) {
      console.error('Get symbol posts error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get symbol posts',
      });
    }
  })
);

// 심볼 정보 조회
router.get('/:ticker', async (req: Request, res: Response): Promise<void> => {
  try {
    const { ticker } = req.params;
    if (!ticker) {
      res.status(400).json({
        success: false,
        error: 'Ticker is required',
      });
      return;
    }

    const symbol = await prisma.symbol.findFirst({
      where: {
        ticker: ticker.toUpperCase(),
      },
      include: {
        _count: {
          select: {
            posts: true,
          },
        },
      },
    });

    if (!symbol) {
      res.status(404).json({
        success: false,
        error: 'Symbol not found',
      });
      return;
    }

    res.json({
      success: true,
      data: { symbol },
    });
  } catch (error) {
    console.error('Get symbol error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get symbol',
    });
  }
});

// 심볼 감성 분석 조회
router.get(
  '/:ticker/sentiment',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticker } = req.params;
      if (!ticker) {
        res.status(400).json({
          success: false,
          error: 'Ticker is required',
        });
        return;
      }

      // 심볼 존재 확인
      const symbol = await prisma.symbol.findFirst({
        where: {
          ticker: ticker.toUpperCase(),
        },
      });

      if (!symbol) {
        res.status(404).json({
          success: false,
          error: 'Symbol not found',
        });
        return;
      }

      // 최근 30일간의 포스트들을 분석
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const posts = await prisma.post.findMany({
        where: {
          symbols: {
            some: {
              symbolId: symbol.id,
            },
          },
          createdAt: {
            gte: thirtyDaysAgo,
          },
        },
        include: {
          reactions: {
            select: {
              type: true,
            },
          },
        },
      });

      // 감성 분석 알고리즘
      let bullishScore = 0;
      let bearishScore = 0;
      let totalPosts = posts.length;
      let totalReactions = 0;

      for (const post of posts) {
        const text = post.text.toLowerCase();

        // 반응 수 누적
        totalReactions += post.reactions.length;

        // 긍정적 키워드 (한국어 + 영어)
        const bullishKeywords = [
          '상승',
          '올라',
          '오를',
          '호재',
          '좋다',
          '좋은',
          '매수',
          '추천',
          'buy',
          'bull',
          'bullish',
          'up',
          'rise',
          'moon',
          '🚀',
          '📈',
          '투더문',
          '강세',
          '갈만',
          '올림',
          '상한가',
        ];

        // 부정적 키워드 (한국어 + 영어)
        const bearishKeywords = [
          '하락',
          '떨어',
          '내려',
          '악재',
          '나쁘',
          '매도',
          '위험',
          'sell',
          'bear',
          'bearish',
          'down',
          'fall',
          'crash',
          '📉',
          '약세',
          '망함',
          '폭락',
          '하한가',
          '손절',
        ];

        // 텍스트 감성 분석
        let postSentiment = 0;

        bullishKeywords.forEach(keyword => {
          if (text.includes(keyword)) {
            postSentiment += 1;
          }
        });

        bearishKeywords.forEach(keyword => {
          if (text.includes(keyword)) {
            postSentiment -= 1;
          }
        });

        // 반응 분석 (좋아요는 긍정, 부정 반응은 약세로 간주)
        const reactions = post.reactions;
        const likes = reactions.filter(r => r.type === 'LIKE').length;
        const boosts = reactions.filter(r => r.type === 'BOOST').length;

        // 반응이 많을수록 해당 감성이 더 강화됨
        const reactionMultiplier = Math.min((likes + boosts) / 5, 2); // 최대 2배까지

        if (postSentiment > 0) {
          bullishScore += postSentiment * (1 + reactionMultiplier);
        } else if (postSentiment < 0) {
          bearishScore += Math.abs(postSentiment) * (1 + reactionMultiplier);
        } else {
          // 중립적인 포스트는 반응 수에 따라 약간의 긍정으로 간주
          if (likes + boosts > 3) {
            bullishScore += 0.5;
          }
        }
      }

      // 기본값 처리 (데이터가 없을 때)
      if (totalPosts === 0) {
        res.json({
          success: true,
          data: {
            bullishPercentage: 50,
            bearishPercentage: 50,
            totalPosts: 0,
            totalReactions: 0,
            confidence: 0,
          },
        });
        return;
      }

      // 퍼센트 계산
      const totalScore = bullishScore + bearishScore;
      let bullishPercent = 50;
      let bearishPercent = 50;
      let confidence = 0;

      if (totalScore > 0) {
        bullishPercent = Math.round((bullishScore / totalScore) * 100);
        bearishPercent = 100 - bullishPercent;

        // 신뢰도 계산 (포스트 수와 감성 차이에 기반)
        const scoreDifference = Math.abs(bullishScore - bearishScore);
        confidence = Math.min(
          (totalPosts / 10) * 0.5 + (scoreDifference / totalScore) * 0.5,
          1
        );
      }

      res.json({
        success: true,
        data: {
          bullishPercentage: bullishPercent,
          bearishPercentage: bearishPercent,
          totalPosts,
          totalReactions: totalReactions,
          confidence: confidence, // 0~1 사이 값으로 보냄
        },
      });
    } catch (error) {
      console.error('Get symbol sentiment error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get symbol sentiment',
      });
    }
  }
);

// 인기 심볼 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query['limit'] as string) || 20, 50);

    const symbols = await prisma.symbol.findMany({
      orderBy: {
        posts: {
          _count: 'desc',
        },
      },
      take: limit,
      include: {
        _count: {
          select: {
            posts: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: { symbols },
    });
  } catch (error) {
    console.error('Get popular symbols error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get popular symbols',
    });
  }
});

export default router;
