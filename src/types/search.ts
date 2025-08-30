import { Prisma } from '@prisma/client';
import { z } from 'zod';

export const SearchedUser = z.object({
  id: z.number(),
  handle: z.string(),
  displayName: z.string(),
  bio: z.string().nullable(), // bio가 null 가능
  avatar: z.string().nullable(), // avatar가 null
  verified: z.boolean(),
  followerCount: z.number(),
  followingCount: z.number(),
  postCount: z.number(),
  trustScore: z.number(),
  rank: z.number(),
  highlights: z.object({
    handle: z.array(z.string()),
    displayName: z.array(z.string()),
    bio: z.union([z.array(z.string()), z.string()]),
  }),
});

export const SearchedPosts = z.object({
  id: z.number(),
  content: z.string(),
  author: z.object({
    id: z.number(),
    handle: z.string(),
    displayName: z.string(),
    bio: z.string().nullable(),
    trustScore: z.number().nullable(),
    verifiedFlags: z.any().nullable(),
  }),
  createdAt: z.string(),
  reactionCounts: z.record(z.string(), z.number()),
  rank: z.number(),
  highlights: z.array(z.string()),
  symbols: z.array(
    z.object({
      ticker: z.string(),
      kind: z.string(),
      exchange: z.string().nullable(),
    })
  ),
});

export const SearchedResponse = z.object({
  query: z.string(),
  type: z.enum(['posts', 'people']),
  total: z.number(),
  searchTime: z.number(),
  people: z
    .object({
      items: z.array(SearchedUser),
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    })
    .nullable(),
  posts: z
    .object({
      items: z.array(SearchedPosts),
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    })
    .nullable(),
});

export type UserWithCounts = Prisma.UserGetPayload<{
  include: {
    _count: {
      select: {
        followers: true;
        following: true;
        posts: true;
      };
    };
  };
}>;

export const searchQuerySchema = z.object({
  query: z.string().min(1).max(200).trim(),
  type: z.enum(['posts', 'people']),
  limit: z.coerce.number().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export type SearchedUser = z.infer<typeof SearchedUser>;
export type SearchedResponse = z.infer<typeof SearchedResponse>;
