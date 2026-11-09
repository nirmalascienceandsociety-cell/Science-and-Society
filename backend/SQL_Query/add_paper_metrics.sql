-- ⚠️  WARNING: DO NOT RUN THIS FILE ON PRODUCTION AFTER safe_update_only.sql ⚠️
-- This file redefines published_issues WITHOUT the email-stripping and security hardening
-- applied by safe_update_only.sql. Running it would re-expose file_url, status, and raw
-- authors (including author emails) to anonymous visitors.
--
-- The views_count / citations_count columns and the increment_paper_views RPC from this
-- file have been merged into safe_update_only.sql (the canonical migration script).
-- Only run this file on a fresh/dev database BEFORE running safe_update_only.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- Migration: Add Paper Metrics (Views & Citations)
ALTER TABLE public.journals 
ADD COLUMN IF NOT EXISTS views_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS citations_count INTEGER NOT NULL DEFAULT 0;

-- Update published_issues view to include metrics
CREATE OR REPLACE VIEW public.published_issues AS
SELECT 
  j.id,
  j.title,
  j.abstract,
  j.category,
  j.keywords,
  j.file_url,
  j.status,
  j.authors,
  j.author_name,
  j.volume_number,
  j.issue_number,
  j.published_at,
  j.created_at,
  COALESCE(j.views_count, 0) AS views_count,
  COALESCE(j.citations_count, 0) AS citations_count
FROM public.journals j
WHERE j.status = 'published'
ORDER BY j.published_at DESC;

-- Atomic RPC function to increment views safely
CREATE OR REPLACE FUNCTION public.increment_paper_views(p_journal_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.journals
  SET views_count = COALESCE(views_count, 0) + 1
  WHERE id = p_journal_id AND status = 'published';
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.increment_paper_views(UUID) TO anon, authenticated, service_role;
