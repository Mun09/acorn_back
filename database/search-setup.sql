-- PostgreSQL Search Setup Script
-- This script sets up the necessary extensions and configurations for search functionality

-- Enable pg_trgm extension for trigram similarity search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable unaccent extension for accent-insensitive search
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Create indexes for efficient search on posts
CREATE INDEX IF NOT EXISTS idx_posts_content_trgm ON posts USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_posts_content_text ON posts USING gin (to_tsvector('english', content));

-- Create indexes for user search
CREATE INDEX IF NOT EXISTS idx_users_handle_trgm ON users USING gin (handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_display_name_trgm ON users USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_search_text ON users USING gin (
  to_tsvector('english', coalesce(handle, '') || ' ' || coalesce(display_name, '') || ' ' || coalesce(bio, ''))
);

-- Create indexes for symbol search
CREATE INDEX IF NOT EXISTS idx_symbols_ticker_trgm ON symbols USING gin (ticker gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_symbols_name_trgm ON symbols USING gin (name gin_trgm_ops) WHERE name IS NOT NULL;

-- Set minimum similarity threshold for trigram search (0.1 = 10% similarity)
-- This can be adjusted based on search quality requirements
SET pg_trgm.similarity_threshold = 0.1;

-- Create a function for calculating search rank
CREATE OR REPLACE FUNCTION calculate_search_rank(
  content TEXT,
  query TEXT,
  created_at TIMESTAMP DEFAULT NOW()
) RETURNS FLOAT AS $$
DECLARE
  similarity_score FLOAT;
  recency_boost FLOAT;
  final_rank FLOAT;
BEGIN
  -- Calculate trigram similarity (0.0 to 1.0)
  similarity_score := similarity(content, query);
  
  -- Calculate recency boost (newer content gets higher rank)
  -- Content from last 24 hours gets 1.0, older content gets exponential decay
  recency_boost := CASE 
    WHEN created_at > NOW() - INTERVAL '1 day' THEN 1.0
    WHEN created_at > NOW() - INTERVAL '1 week' THEN 0.8
    WHEN created_at > NOW() - INTERVAL '1 month' THEN 0.6
    ELSE 0.4
  END;
  
  -- Combine similarity and recency (70% similarity, 30% recency)
  final_rank := (similarity_score * 0.7) + (recency_boost * 0.3);
  
  RETURN final_rank;
END;
$$ LANGUAGE plpgsql;

-- Create materialized view for popular symbols (refresh periodically)
CREATE MATERIALIZED VIEW IF NOT EXISTS popular_symbols AS
SELECT 
  s.id,
  s.ticker,
  s.name,
  s.kind,
  COUNT(ps.post_id) as mention_count,
  MAX(p.created_at) as last_mentioned
FROM symbols s
LEFT JOIN post_symbols ps ON s.id = ps.symbol_id
LEFT JOIN posts p ON ps.post_id = p.id
WHERE p.created_at > NOW() - INTERVAL '30 days'
GROUP BY s.id, s.ticker, s.name, s.kind
ORDER BY mention_count DESC;

-- Create unique index on the materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_popular_symbols_id ON popular_symbols (id);

-- Create a function to refresh popular symbols (call this periodically)
CREATE OR REPLACE FUNCTION refresh_popular_symbols() RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY popular_symbols;
END;
$$ LANGUAGE plpgsql;

-- Performance optimization: increase work_mem for search queries
-- This should be set in postgresql.conf for production
-- work_mem = 256MB

-- Example usage queries:

-- Search posts with ranking
/*
SELECT 
  p.id,
  p.content,
  p.created_at,
  calculate_search_rank(p.content, 'search query', p.created_at) as rank
FROM posts p
WHERE 
  p.content ILIKE '%search%' 
  OR similarity(p.content, 'search query') > 0.1
ORDER BY rank DESC, p.created_at DESC
LIMIT 20;
*/

-- Search users
/*
SELECT 
  u.id,
  u.handle,
  u.display_name,
  similarity(u.handle || ' ' || coalesce(u.display_name, ''), 'search query') as rank
FROM users u
WHERE 
  u.handle ILIKE '%search%'
  OR u.display_name ILIKE '%search%'
  OR similarity(u.handle || ' ' || coalesce(u.display_name, ''), 'search query') > 0.1
ORDER BY rank DESC
LIMIT 20;
*/

-- Search symbols
/*
SELECT 
  s.id,
  s.ticker,
  s.name,
  s.kind,
  similarity(s.ticker || ' ' || coalesce(s.name, ''), 'search query') as rank
FROM symbols s
WHERE 
  s.ticker ILIKE '%search%'
  OR s.name ILIKE '%search%'
  OR similarity(s.ticker || ' ' || coalesce(s.name, ''), 'search query') > 0.1
ORDER BY rank DESC
LIMIT 20;
*/
