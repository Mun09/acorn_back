import z from 'zod';

// Define a Zod schema for the returned post object
export const PostSchema = z.object({
  id: z.number(),
  text: z.string(),
  userId: z.number(),
  createdAt: z.date(),
  author: z.object({
    id: z.number(),
    handle: z.string(),
    bio: z.string().nullable(),
    trustScore: z.number().nullable(),
    verifiedFlags: z.any(), // Adjust type if you know the structure
  }),
  symbols: z.array(
    z.object({
      raw: z.string(),
      ticker: z.string(),
      kind: z.string(),
      exchange: z.string().nullable(),
    })
  ),
  reactionCounts: z.record(z.string(), z.number()).optional(),
  userReactions: z.array(z.string()).optional(),
  score: z.number().optional(),
  scoreBreakdown: z
    .object({
      initialReactionScore: z.number(),
      timeDecayScore: z.number(),
      symbolMatchScore: z.number(),
      totalScore: z.number(),
    })
    .optional(),
  replies: z.array(z.any()).optional(),
});

export type SearchPostsResult = {
  items: Post[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type Post = z.infer<typeof PostSchema>;
