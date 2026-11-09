BEGIN;

-- ============================================================
-- Science and Society 2026 — SAFE UPDATE SCRIPT (DEFINITIVE FINAL)
-- ✅ Safe to run in Supabase SQL Editor. Fully idempotent — safe to re-run.
-- ✅ WILL NOT drop any tables or delete any published data.
-- ✅ All 46 volumes and 460+ published papers will remain untouched.
-- ✅ The nirmala.scienceandsociety@gmail.com account is permanently protected.
--
-- ARCHITECTURE DECISIONS (based on full frontend code inspection):
-- • Storage bucket is PRIVATE (public = false). All file access must go through
--   createSignedUrl() to enforce RLS (which protects unpublished manuscripts).
--   The frontend has been updated to generate signed URLs on demand instead of
--   relying on public CDN links.
-- • Storage RLS: dead LIKE/position clauses on `abstract` column are removed since
--   abstract is plain text, not a storage path. file_url matching kept and improved.
-- ============================================================


-- ============================================================
-- 1. ADD NEW TABLES (Safe — only creates if they don't already exist)
-- ============================================================

-- NOTIFICATIONS TABLE: In-app bell notification system
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  title text not null default 'Notification',
  message text not null default '',
  link text,
  is_read boolean not null default false,
  created_at timestamptz default now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Lint B: Drop the stale always-true INSERT policy left by the old schema.
-- Service role bypasses RLS automatically — no INSERT policy is needed or desirable.
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;

DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
CREATE POLICY "Users can read own notifications" ON public.notifications
  FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can mark own notifications read" ON public.notifications;
CREATE POLICY "Users can mark own notifications read" ON public.notifications
  FOR UPDATE USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);


-- CURRENT ISSUE TABLE: Submission open/close state and live issue metadata
CREATE TABLE IF NOT EXISTS public.current_issue (
  id integer primary key default 1 check (id = 1),
  volume_topic text not null default 'Advances in Modern Research',
  volume_number text not null default 'Volume 1',
  issue_number text not null default 'Issue 1',
  timeline text not null default 'January to June 2026',
  last_submission_date date,
  student_topics jsonb not null default '["Artificial Intelligence", "Sustainable Energy", "Quantum Computing", "Biotechnology"]'::jsonb,
  is_open boolean not null default true,
  updated_at timestamptz default now()
);

INSERT INTO public.current_issue (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.current_issue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read current_issue" ON public.current_issue;
CREATE POLICY "Anyone can read current_issue" ON public.current_issue FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can update current_issue" ON public.current_issue;
CREATE POLICY "Admins can update current_issue" ON public.current_issue
  FOR UPDATE USING (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));


-- ============================================================
-- 2. ADD MISSING COLUMNS TO EXISTING TABLES
-- ============================================================

ALTER TABLE public.journals ADD COLUMN IF NOT EXISTS authors jsonb not null default '[]'::jsonb;
ALTER TABLE public.journals ADD COLUMN IF NOT EXISTS prev_reviewer_name text;
ALTER TABLE public.journals ADD COLUMN IF NOT EXISTS volume_number text;
ALTER TABLE public.journals ADD COLUMN IF NOT EXISTS issue_number text;
ALTER TABLE public.journals ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.journals ADD COLUMN IF NOT EXISTS views_count integer not null default 0;
ALTER TABLE public.journals ADD COLUMN IF NOT EXISTS citations_count integer not null default 0;

ALTER TABLE public.paper_requests ADD COLUMN IF NOT EXISTS affiliation text;
ALTER TABLE public.paper_requests ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.paper_requests ADD COLUMN IF NOT EXISTS admin_notes text;

-- Add UNIQUE constraint to profiles.email.
-- Guard 1: IF NOT EXISTS skips the ALTER TABLE entirely on re-runs (avoids duplicate_object).
-- Guard 2: EXCEPTION WHEN unique_violation handles the case where the constraint doesn't exist
--          yet but duplicate emails are already present in the live table. In that case,
--          the constraint cannot be added until duplicates are resolved — we NOTICE and continue
--          so the rest of the script (storage fixes, triggers, etc.) still lands.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_email_key'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);
  END IF;
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'SKIPPED profiles_email_key: duplicate emails exist in profiles table. '
                 'Run: SELECT email, count(*) FROM public.profiles GROUP BY email HAVING count(*) > 1; '
                 'to find and resolve them, then re-run this script.';
END $$;



-- ============================================================
-- 3. UPDATE STATUS CONSTRAINTS
-- ============================================================

-- Expand journal statuses to match the full workflow state machine
ALTER TABLE public.journals DROP CONSTRAINT IF EXISTS journals_status_check;
ALTER TABLE public.journals ADD CONSTRAINT journals_status_check
  CHECK (status in (
    'submitted', 'pending', 'under_review', 'review_complete',
    'approved', 'accepted', 'revision_required', 'rework',
    'rejected', 'published'
  ));

-- Restore 'responded' which was accidentally dropped in migration_v2.sql
ALTER TABLE public.paper_requests DROP CONSTRAINT IF EXISTS paper_requests_status_check;
ALTER TABLE public.paper_requests ADD CONSTRAINT paper_requests_status_check
  CHECK (status in ('pending', 'approved', 'rejected', 'responded'));


-- ============================================================
-- 4. PUBLISHED ISSUES VIEW
-- ============================================================
-- Uses security_invoker = false (SECURITY DEFINER semantics).
-- The view itself enforces WHERE status = 'published' and only exposes
-- safe, public-facing columns. No RLS safety net exists behind it,
-- so treat this view definition as security-critical — any change to
-- the WHERE clause or column list here exposes raw journal data.
-- ⚠️  Never add file_url, student_id, reviewer_id, admin_comments,
--     revision_report_url, or approval_proof_url to this view.
-- Note: Supabase Lint 0010 flags this as a "security_definer_view". This is a false
-- positive. We intentionally use this pattern to achieve column-level security without
-- opening the base journals table to the public REST API.
CREATE OR REPLACE VIEW public.published_issues WITH (security_invoker = false) AS
SELECT
  j.id,
  j.title,
  j.abstract,
  j.category,
  j.keywords,
  (
    SELECT COALESCE(
      jsonb_agg(elem - 'email'),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(j.authors) AS elem
  ) AS authors,
  j.volume_number,
  j.issue_number,
  j.published_at,
  j.created_at,
  j.author_name,
  -- SEC-F: Include metrics so FutureIssues/PublishedPapers can use the safe view
  -- without touching the base table. file_url is intentionally excluded.
  COALESCE(j.views_count, 0)     AS views_count,
  COALESCE(j.citations_count, 0) AS citations_count
FROM public.journals j
WHERE j.status = 'published';

-- Explicit grant required — default privileges on views are NOT inherited from the table
GRANT SELECT ON public.published_issues TO anon, authenticated;

-- Drop the now-redundant direct-table open policy (the view is the only public read path)
DROP POLICY IF EXISTS "Anyone can read published journals" ON public.journals;

-- SEC-F: Performance index — queries filtered by status (view + admin panel) benefit greatly
CREATE INDEX IF NOT EXISTS idx_journals_status ON public.journals(status);

-- SEC-P: Remove anon INSERT on paper_requests — all inserts now go via service-role backend.
-- The /api/notify/paper-request backend route handles validation, rate-limiting, and honeypot.
DROP POLICY IF EXISTS "Anyone can insert paper_requests" ON public.paper_requests;
DROP POLICY IF EXISTS "Anon can insert paper_requests" ON public.paper_requests;


-- ============================================================
-- 5. HARDEN RLS POLICIES
-- ============================================================

-- Admin profile updates: allow admins to edit non-permanent profiles only.
-- USING targets only non-permanent rows (root admin row is untouchable).
-- WITH CHECK ensures the result row is also not marked permanent.
-- Alias p2 avoids ambiguity between outer row's is_permanent and the subquery.
DROP POLICY IF EXISTS "Admins can update user status" ON public.profiles;
CREATE POLICY "Admins can update user status" ON public.profiles
  FOR UPDATE USING (
    exists (select 1 from public.profiles p2 where p2.id = (select auth.uid()) and p2.role = 'admin')
    AND is_permanent = false
  ) WITH CHECK (
    is_permanent = false
  );

-- Reviewer name visibility: PII Leak Fix. Removed the policy that allowed
-- any authenticated user (like students) to see all reviewers. Double-blind integrity restored.
DROP POLICY IF EXISTS "Anyone can see reviewer names" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can see reviewer names" ON public.profiles;

-- Review visibility: students only see their review after a final decision is made.
-- Includes 'rejected' so students can see rejection feedback.
DROP POLICY IF EXISTS "Restricted read reviews" ON public.reviews;
CREATE POLICY "Restricted read reviews" ON public.reviews FOR SELECT
  USING (
    (select auth.uid()) = reviewer_id
    or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin')
    or (
      exists (select 1 from public.journals where id = journal_id and student_id = (select auth.uid()))
      and exists (select 1 from public.journals where id = journal_id and status in (
        'review_complete', 'accepted', 'approved', 'revision_required', 'rework', 'rejected', 'published'
      ))
    )
  );

-- Journal visibility: Students see own, Admins see all, Reviewers see assigned
DROP POLICY IF EXISTS "Students see own journals" ON public.journals;
DROP POLICY IF EXISTS "Read access for journals" ON public.journals;
CREATE POLICY "Read access for journals" ON public.journals FOR SELECT
  USING (
    (select auth.uid()) = student_id or
    exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin') or
    exists (select 1 from public.assignments where journal_id = journals.id and reviewer_id = (select auth.uid()))
  );

-- Journal insert: students must be active; submissions must be open
DROP POLICY IF EXISTS "Students can insert journals when open" ON public.journals;
CREATE POLICY "Students can insert journals when open" ON public.journals FOR INSERT
  WITH CHECK (
    (select auth.uid()) = student_id
    and (select is_open from public.current_issue where id = 1) = true
    and (select status from public.profiles where id = auth.uid()) = 'active'
  );

-- Review insert: reviewer must be active and assigned
DROP POLICY IF EXISTS "Reviewers can insert reviews" ON public.reviews;
CREATE POLICY "Reviewers can insert reviews" ON public.reviews FOR INSERT
  WITH CHECK (
    (select auth.uid()) = reviewer_id
    and exists (
      select 1 from public.assignments
      where journal_id = public.reviews.journal_id and reviewer_id = (select auth.uid())
    )
    and (select status from public.profiles where id = auth.uid()) = 'active'
  );

-- Admin journal insert (for legacy/manual uploads via admin panel)
DROP POLICY IF EXISTS "Admins can insert journals" ON public.journals;
CREATE POLICY "Admins can insert journals" ON public.journals
  FOR INSERT WITH CHECK (
    exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin')
  );


-- ============================================================
-- 6. STORAGE POLICIES
-- ============================================================
-- ARCHITECTURE: Bucket is PRIVATE. All file access must go through createSignedUrl()
-- to ensure Storage RLS is evaluated and confidentiality of manuscripts is preserved.
-- Dead code removed: abstract is plain text in this app, not a storage path.

INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit) 
VALUES ('journals', 'journals', false, ARRAY['application/pdf']::text[], 10485760)
ON CONFLICT (id) DO UPDATE SET 
  public = false,
  allowed_mime_types = ARRAY['application/pdf']::text[],
  file_size_limit = 10485760;

-- READ POLICY: Owner, admin, assigned reviewer, or the paper's own student
DROP POLICY IF EXISTS "Anyone can read journal files" ON storage.objects;
DROP POLICY IF EXISTS "Public can read published journals" ON storage.objects;
DROP POLICY IF EXISTS "Journal files access control" ON storage.objects;
CREATE POLICY "Journal files access control" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'journals'
    AND (
      -- 1. Uploader can always access their own files
      --    (owner is populated for client-side direct uploads with user JWT)
      owner = auth.uid()
      -- 2. Admins can read any file
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
      )
      -- 3. Active assigned reviewers can read the manuscript and revision report
      OR EXISTS (
        SELECT 1 FROM public.assignments a
        JOIN public.journals j ON a.journal_id = j.id
        WHERE a.reviewer_id = (select auth.uid())
        AND (SELECT status FROM public.profiles WHERE id = auth.uid()) = 'active'
        AND (
          -- Exact match for new bare-path records (e.g. uuid/timestamp_file.pdf)
          -- OR suffix-anchored plain string comparison for old full-URL records.
          -- Uses right() instead of LIKE to avoid metacharacter widening —
          -- '_' in timestamp filenames would make LIKE match any single char there.
          j.file_url = storage.objects.name
          OR right(j.file_url, length(storage.objects.name) + 1) = '/' || storage.objects.name
          OR coalesce(j.revision_report_url, '') = storage.objects.name
          OR right(coalesce(j.revision_report_url, ''), length(storage.objects.name) + 1) = '/' || storage.objects.name
        )
      )
      -- 4. Active students can read files belonging to their own journals
      OR EXISTS (
        SELECT 1 FROM public.journals j
        WHERE j.student_id = (select auth.uid())
        AND (SELECT status FROM public.profiles WHERE id = auth.uid()) = 'active'
        AND (
          j.file_url = storage.objects.name
          OR right(j.file_url, length(storage.objects.name) + 1) = '/' || storage.objects.name
          OR coalesce(j.revision_report_url, '') = storage.objects.name
          OR right(coalesce(j.revision_report_url, ''), length(storage.objects.name) + 1) = '/' || storage.objects.name
          OR coalesce(j.approval_proof_url, '') = storage.objects.name
          OR right(coalesce(j.approval_proof_url, ''), length(storage.objects.name) + 1) = '/' || storage.objects.name
        )
      )
    )
  );

-- UPLOAD POLICY: Strict per-role, per-user path isolation to prevent filename collisions
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload to their own folder" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload to journals" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload to specific folders securely" ON storage.objects;
CREATE POLICY "Users can upload to specific folders securely" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'journals'
    AND auth.role() = 'authenticated'
    AND (
      -- Students: must upload to their own UID-named folder (e.g. {uid}/timestamp.pdf)
      -- This prevents filename collisions between different students entirely.
      (
        (storage.foldername(name))[1] = (select auth.uid())::text
        AND EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'student' AND status = 'active'
        )
      )
      -- Reviewers: scoped to reviewer/{reviewer_id}/ to avoid inter-reviewer collisions
      OR (
        (storage.foldername(name))[1] = 'reviewer'
        AND (storage.foldername(name))[2] = (select auth.uid())::text
        AND EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'reviewer' AND status = 'active'
        )
      )
      -- Admins: scoped to admin/{admin_id}/
      OR (
        (storage.foldername(name))[1] = 'admin'
        AND (storage.foldername(name))[2] = (select auth.uid())::text
        AND EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
    )
  );

-- DELETE POLICY: Owner or admin only
DROP POLICY IF EXISTS "Authenticated users can delete own files" ON storage.objects;
CREATE POLICY "Authenticated users can delete own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'journals'
    AND (
      owner = auth.uid()
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    )
  );


-- ============================================================
-- 7. RPC FUNCTIONS
-- ============================================================

-- Drop old 10-argument overload to prevent signature collision
DROP FUNCTION IF EXISTS public.resubmit_journal(uuid, text, text, text, text, text, text, text, text, int);

-- resubmit_journal: Student-facing RPC to resubmit a paper after revision.
-- Security: validates ownership AND current status (only revision_required/rework allowed).
-- resubmission_count is always computed server-side — client value is ignored.
-- p_authors defaults to NULL so COALESCE correctly falls back to the existing value.
CREATE OR REPLACE FUNCTION public.resubmit_journal(
  p_journal_id            uuid,
  p_title                 text,
  p_abstract              text,
  p_keywords              text,
  p_file_url              text,
  p_prev_admin_comments   text,
  p_prev_revision_report_url text,
  p_prev_reviewer_comments text,
  p_prev_reviewer_name    text,
  p_resubmission_count    int,     -- Ignored; computed server-side
  p_authors               jsonb DEFAULT NULL,
  p_author_name           text  DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student_id uuid;
  v_status     text;
BEGIN
  SELECT student_id, status
    INTO v_student_id, v_status
    FROM public.journals WHERE id = p_journal_id;

  IF v_student_id IS NULL OR v_student_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_status NOT IN ('revision_required', 'rework') THEN
    RAISE EXCEPTION 'This paper is not currently open for resubmission. Status: %', v_status;
  END IF;

  UPDATE public.journals SET
    title                    = p_title,
    abstract                 = p_abstract,
    keywords                 = p_keywords,
    file_url                 = p_file_url,
    authors                  = COALESCE(p_authors,       authors),
    author_name              = COALESCE(p_author_name,   author_name),
    status                   = 'submitted',
    review_level             = 0,
    resubmission_count       = resubmission_count + 1,    -- Always server-side
    prev_admin_comments      = p_prev_admin_comments,
    prev_revision_report_url = p_prev_revision_report_url,
    prev_reviewer_comments   = p_prev_reviewer_comments,
    prev_reviewer_name       = p_prev_reviewer_name,
    admin_comments           = NULL,
    revision_report_url      = NULL,
    approval_proof_url       = NULL
  WHERE id = p_journal_id;

  DELETE FROM public.reviews WHERE journal_id = p_journal_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resubmit_journal(uuid, text, text, text, text, text, text, text, text, int, jsonb, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.resubmit_journal(uuid, text, text, text, text, text, text, text, text, int, jsonb, text) TO authenticated;


-- schedule_account_deletion: Sets the 15-day deletion countdown server-side.
-- Trigger 3 blocks backdating, so this is the only safe way to set the timestamp.
CREATE OR REPLACE FUNCTION public.schedule_account_deletion()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET deletion_scheduled_at = NOW() WHERE id = auth.uid();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.schedule_account_deletion() FROM public;
GRANT  EXECUTE ON FUNCTION public.schedule_account_deletion() TO authenticated;


-- cancel_account_deletion: Clears the deletion countdown. Trigger 3 allows NULL
-- (clearing) because NULL is not earlier than the current value.
CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET deletion_scheduled_at = NULL WHERE id = auth.uid();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cancel_account_deletion() FROM public;
GRANT  EXECUTE ON FUNCTION public.cancel_account_deletion() TO authenticated;


-- approve_reviewer: Admin-only RPC. Explicitly checks target has role='reviewer'
-- so it cannot be accidentally repurposed as a generic account-reactivation tool.
DROP FUNCTION IF EXISTS public.approve_reviewer(uuid);
CREATE OR REPLACE FUNCTION public.approve_reviewer(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.profiles SET status = 'active'
    WHERE id = p_user_id AND role = 'reviewer';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.approve_reviewer(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.approve_reviewer(uuid) TO authenticated;

-- promote_to_admin: Elevates an active user to the admin role.
-- SECURITY: Callable only by the permanent admin (is_permanent = true).
-- A regular sub-admin cannot promote others to admin.
-- The target user must be active (not pending/suspended) and not already an admin.
DROP FUNCTION IF EXISTS public.promote_to_admin(uuid);
CREATE OR REPLACE FUNCTION public.promote_to_admin(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only the permanent admin can call this function
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_permanent = true) THEN
    RAISE EXCEPTION 'Unauthorized: only the permanent admin can promote users to admin';
  END IF;
  -- The target must exist, be active, and not already be an admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND status = 'active' AND role != 'admin') THEN
    RAISE EXCEPTION 'Target user is not eligible for promotion (must be active and not already an admin)';
  END IF;
  UPDATE public.profiles SET role = 'admin' WHERE id = p_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.promote_to_admin(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.promote_to_admin(uuid) TO authenticated;


-- demote_from_admin: Reverts an admin back to the 'student' role.
-- SECURITY: Callable only by the permanent admin (is_permanent = true).
-- A regular sub-admin cannot demote others, and the permanent admin cannot demote themselves.
DROP FUNCTION IF EXISTS public.demote_from_admin(uuid);
CREATE OR REPLACE FUNCTION public.demote_from_admin(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only the permanent admin can call this function
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_permanent = true) THEN
    RAISE EXCEPTION 'Unauthorized: only the permanent admin can demote admins';
  END IF;
  -- Cannot demote yourself (the permanent admin)
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot demote yourself';
  END IF;
  -- Target must be a non-permanent admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'admin' AND is_permanent = false) THEN
    RAISE EXCEPTION 'Target user is not a demotable admin';
  END IF;
  UPDATE public.profiles SET role = 'student' WHERE id = p_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.demote_from_admin(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.demote_from_admin(uuid) TO authenticated;


-- Revoke public execute from schema.sql functions that lacked it
REVOKE EXECUTE ON FUNCTION public.ban_user(uuid)   FROM public;
REVOKE EXECUTE ON FUNCTION public.unban_user(uuid) FROM public;


-- ============================================================
-- 8. TRIGGERS
-- ============================================================

-- TRIGGER 1: Force author_name from profiles on student submission.
-- Admin bypass: if the actor IS an admin, preserve whatever author_name they typed
-- (needed for importing legacy papers with manually-entered author names).
CREATE OR REPLACE FUNCTION public.set_journal_author_name()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated', 'service_role')
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  THEN
    SELECT name INTO NEW.author_name FROM public.profiles WHERE id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_set_journal_author_name ON public.journals;
CREATE TRIGGER trg_set_journal_author_name
  BEFORE INSERT ON public.journals
  FOR EACH ROW EXECUTE FUNCTION public.set_journal_author_name();


-- TRIGGER 2: Protect root admin in auth.users (DELETE and email change)
CREATE OR REPLACE FUNCTION public.protect_permanent_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_permanent boolean;
BEGIN
  SELECT is_permanent INTO v_is_permanent FROM public.profiles WHERE id = OLD.id;

  IF TG_OP = 'DELETE' AND v_is_permanent = true THEN
    RAISE EXCEPTION 'SECURITY: The permanent admin account cannot be deleted.';
  END IF;
  
  IF TG_OP = 'UPDATE'
     AND v_is_permanent = true
     AND NEW.email != OLD.email
  THEN
    RAISE EXCEPTION 'SECURITY: The permanent admin account email cannot be changed.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS enforce_permanent_admin ON auth.users;
CREATE TRIGGER enforce_permanent_admin
  BEFORE DELETE OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_permanent_admin();


-- TRIGGER 2B: Protect root admin profile row from DELETE
-- (auth.users trigger protects login; this protects the profile row)
CREATE OR REPLACE FUNCTION public.protect_permanent_admin_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.is_permanent = true THEN
    RAISE EXCEPTION 'SECURITY: A permanent admin profile row cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS enforce_permanent_admin_profile ON public.profiles;
CREATE TRIGGER enforce_permanent_admin_profile
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_permanent_admin_profile();


-- TRIGGER 3: Block profile self-escalation and backdated deletion
--
-- Logic breakdown:
--   INSERT (non-admin): clamp role/status/is_permanent to safe defaults
--   UPDATE (anyone):    is_permanent is ALWAYS preserved (no one can change it via API)
--   UPDATE (non-admin): role and status are also frozen
--   UPDATE (anyone):    deletion_scheduled_at may move forward or be cleared (NULL),
--                       but never backward (blocks backdating the grace period)
--
-- Role-gating logic: the trigger fires when current_setting('role') is anon, authenticated,
-- or service_role — i.e., all API and backend traffic. It is SKIPPED for the postgres
-- superuser role (SQL Editor), which allows the Section 9 bootstrap INSERT/UPDATE to work.
--
-- WHY service_role is safely handled for this codebase:
-- The only admin-elevated journal/profile inserts (e.g. PublishLegacy.jsx) happen
-- from the browser using the admin's authenticated session, so auth.uid() is valid.
-- The backend's service_role calls only insert profiles during registration (with already-
-- correct values: role, status, is_permanent: false), so stripping is harmless anyway.
CREATE OR REPLACE FUNCTION public.enforce_profile_role_integrity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated', 'service_role') THEN

    IF TG_OP = 'INSERT' THEN
      IF current_setting('role', true) = 'service_role' OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        -- Allow service_role (Express backend) and admins to specify valid roles/statuses during profile creation
        IF NEW.role NOT IN ('student', 'reviewer', 'admin') THEN
          NEW.role := 'student';
        END IF;
        IF NEW.status NOT IN ('active', 'pending', 'inactive') THEN
          NEW.status := 'active';
        END IF;
        NEW.is_permanent := COALESCE(NEW.is_permanent, false);
      ELSE
        -- Direct client inserts (anon/authenticated) default to active student
        NEW.role        := 'student';
        NEW.status      := 'active';
        NEW.is_permanent := false;
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      -- is_permanent: frozen for everyone — no API call can change it
      NEW.is_permanent := OLD.is_permanent;

      -- role and status: frozen for non-admins
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        NEW.role   := OLD.role;
        NEW.status := OLD.status;
      END IF;

      -- deletion_scheduled_at: may be set forward or cleared (NULL), never backdated.
      -- NULL is allowed so cancel_account_deletion() works correctly.
      IF NEW.deletion_scheduled_at IS NOT NULL
         AND OLD.deletion_scheduled_at IS NOT NULL
         AND NEW.deletion_scheduled_at < OLD.deletion_scheduled_at
      THEN
        RAISE EXCEPTION 'Cannot backdate account deletion timestamp.';
      END IF;

    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_profile_role_integrity ON public.profiles;
CREATE TRIGGER trg_enforce_profile_role_integrity
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_role_integrity();


-- TRIGGER 4: Block journal metadata forgery on INSERT
-- Strips any injected status, review metadata, or history fields for non-admin submitters.
CREATE OR REPLACE FUNCTION public.enforce_journal_submission_integrity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated', 'service_role')
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  THEN
    NEW.status                   := 'submitted';
    NEW.review_level             := 0;
    NEW.volume_number            := NULL;
    NEW.issue_number             := NULL;
    NEW.published_at             := NULL;
    NEW.prev_admin_comments      := NULL;
    NEW.prev_revision_report_url := NULL;
    NEW.prev_reviewer_comments   := NULL;
    NEW.prev_reviewer_name       := NULL;
    NEW.resubmission_count       := 0;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_journal_submission_integrity ON public.journals;
CREATE TRIGGER trg_enforce_journal_submission_integrity
  BEFORE INSERT ON public.journals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_journal_submission_integrity();


-- TRIGGER 4b: Enforce Storage Isolation (Prevent Arbitrary File Read via file_url forgery)
-- Ensures that students can only point journals.file_url to their own storage folder.
CREATE OR REPLACE FUNCTION public.enforce_journal_file_url_ownership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Service role (backend), Admins, and Reviewers can bypass this restriction
  -- Reviewers need to update journal status when declining assignments (via SECURITY DEFINER RPC)
  IF current_setting('role', true) = 'service_role'
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'reviewer')) THEN
    RETURN NEW;
  END IF;

  -- Only check file_url ownership if file_url is being inserted or modified
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.file_url IS DISTINCT FROM OLD.file_url) THEN
    IF NEW.file_url IS NOT NULL AND NEW.file_url NOT LIKE (NEW.student_id::text || '/%') AND NEW.file_url NOT LIKE (auth.uid()::text || '/%') THEN
      RAISE EXCEPTION 'Forbidden: file_url must belong to your own storage folder';
    END IF;
  END IF;

  -- Prevent students from forging revision/approval URLs on update
  IF TG_OP = 'UPDATE' THEN
    IF NEW.revision_report_url IS DISTINCT FROM OLD.revision_report_url AND NEW.revision_report_url IS NOT NULL THEN
       IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'reviewer')) THEN
         RAISE EXCEPTION 'Forbidden: students cannot set revision_report_url';
       END IF;
    END IF;
    IF NEW.approval_proof_url IS DISTINCT FROM OLD.approval_proof_url AND NEW.approval_proof_url IS NOT NULL THEN
       IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
         RAISE EXCEPTION 'Forbidden: students cannot set approval_proof_url';
       END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_journal_file_url_ownership ON public.journals;
CREATE TRIGGER trg_enforce_journal_file_url_ownership
  BEFORE INSERT OR UPDATE ON public.journals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_journal_file_url_ownership();


-- TRIGGER 5: Block review retargeting (reviewer cannot re-point a review at a different journal)
CREATE OR REPLACE FUNCTION public.enforce_review_journal_integrity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.journal_id != OLD.journal_id THEN
    RAISE EXCEPTION 'Cannot retarget a review to a different journal.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.journals WHERE id = OLD.journal_id AND status != 'under_review') THEN
    RAISE EXCEPTION 'Cannot edit review: journal is no longer under review.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_review_journal_integrity ON public.reviews;
CREATE TRIGGER trg_enforce_review_journal_integrity
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.enforce_review_journal_integrity();


-- TRIGGER 6: Block notification content tampering
-- Users may only flip is_read. Title, message, link, and user_id are immutable after insert.
CREATE OR REPLACE FUNCTION public.enforce_notification_integrity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated', 'service_role') THEN
    NEW.title   := OLD.title;
    NEW.message := OLD.message;
    NEW.link    := OLD.link;
    NEW.user_id := OLD.user_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_notification_integrity ON public.notifications;
CREATE TRIGGER trg_enforce_notification_integrity
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notification_integrity();


-- ============================================================
-- 9. ENSURE ROOT ADMIN PROFILE IS CORRECT
-- ============================================================
-- Note: Trigger 3 gates on current_setting('role') IN ('anon','authenticated','service_role').
-- The postgres superuser role (SQL Editor) does NOT match those values, so the trigger
-- skips its guards here and this INSERT/UPDATE applies correctly without being blocked.
INSERT INTO public.profiles (id, name, email, role, status, is_permanent)
SELECT id, 'Nirmala', 'nirmala.scienceandsociety@gmail.com', 'admin', 'active', true
FROM auth.users WHERE email = 'nirmala.scienceandsociety@gmail.com'
ON CONFLICT (id) DO UPDATE SET
  role         = 'admin',
  status       = 'active',
  is_permanent = true;


-- ============================================================
-- 10. CRON JOB — Scheduled account deactivation
-- ============================================================
-- pg_cron and pg_net must be enabled in Supabase Dashboard > Database > Extensions.
-- If unavailable, the extensions fail silently and the cron is not scheduled.
-- After running this script, verify with: SELECT * FROM cron.job;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron is not available. Enable it in Dashboard > Database > Extensions.';
END $$;

-- pg_net is NOT installed here: it is only needed if pg_cron jobs make HTTP calls.
-- Our cron runs a plain SQL function (no HTTP), so pg_net is not required.
-- Installing it would trigger Supabase lint H (extension_in_public in the public schema).

-- delete_expired_accounts: deactivates profiles and removes non-published journals
-- for users whose 15-day deletion grace period has elapsed.
-- Note: this performs a HARD DELETE using the delete_user RPC.
-- This ensures full GDPR erasure from auth.users (cascading to profiles and journals).
CREATE OR REPLACE FUNCTION public.delete_expired_accounts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  profile_record RECORD;
  fifteen_days_ago TIMESTAMPTZ := NOW() - INTERVAL '15 days';
BEGIN
  FOR profile_record IN
    SELECT id FROM public.profiles
    WHERE deletion_scheduled_at IS NOT NULL
      AND deletion_scheduled_at < fifteen_days_ago
      AND is_permanent = false    -- Never touch the root admin, even in a bug scenario
  LOOP
    DELETE FROM auth.users WHERE id = profile_record.id;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_expired_accounts() FROM public;

-- Unschedule any existing job before re-registering (idempotent)
DO $$ BEGIN
  PERFORM cron.unschedule('delete-expired-accounts');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.schedule(
    'delete-expired-accounts',
    '0 0 * * *',
    'SELECT public.delete_expired_accounts()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule cron job — enable pg_cron first, then re-run Section 10.';
END $$;


-- ============================================================
-- 11. LINT FIXES — RLS POLICY TIGHTENING & FUNCTION PRIVILEGE REVOCATION
-- ============================================================

-- ── Lint C: paper_requests INSERT ────────────────────────────────────────
-- Replace the always-true INSERT policy with one that requires the journal_id
-- to reference an actually-published paper. Keeps the form public (no login
-- required) but prevents spam rows for non-existent or non-published papers.
DROP POLICY IF EXISTS "Anyone can insert paper_requests" ON public.paper_requests;
CREATE POLICY "Anyone can insert paper_requests" ON public.paper_requests
  FOR INSERT WITH CHECK (
    EXISTS (
      -- Query the view, not the base table, because anon users do not have
      -- SELECT privileges on the base journals table.
      SELECT 1 FROM public.published_issues
      WHERE id = journal_id
    )
  );

-- ── Lint D: verification_tokens ──────────────────────────────────────────
-- This table was found in the live database but is not part of our schema.
-- Tighten the always-true DELETE and INSERT policies to require authentication.
DROP POLICY IF EXISTS "Anyone can delete verification tokens" ON public.verification_tokens;
DROP POLICY IF EXISTS "Anyone can insert verification tokens" ON public.verification_tokens;
DO $$ BEGIN
  -- Only apply if the table actually exists (it may not in a fresh deployment)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'verification_tokens') THEN
    EXECUTE $pol$
      ALTER TABLE public.verification_tokens ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Locked verification tokens"
        ON public.verification_tokens
        FOR ALL USING (false) WITH CHECK (false)
    $pol$;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Lints E+F: REVOKE EXECUTE FROM anon/authenticated ────────────────────
-- Trigger body functions: these are called ONLY by trigger machinery, never
-- via the REST API. Revoke from both anon and authenticated so they cannot
-- be called directly even by logged-in users.
REVOKE EXECUTE ON FUNCTION public.enforce_journal_submission_integrity()  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_notification_integrity()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_role_integrity()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_review_journal_integrity()       FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_permanent_admin()                FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_permanent_admin_profile()        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_journal_author_name()                FROM anon, authenticated;

-- Cron-only function: not user-facing, should only be called by the pg_cron scheduler.
REVOKE EXECUTE ON FUNCTION public.delete_expired_accounts()                FROM anon, authenticated;

-- Admin-only RPCs: internal auth check exists inside each function, but
-- REVOKE FROM anon prevents unauthenticated callers from even reaching the check.
REVOKE EXECUTE ON FUNCTION public.approve_reviewer(uuid)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.ban_user(uuid)                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.unban_user(uuid)                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_user(uuid)                        FROM anon;

-- Backend-only RPCs: called only by the Node.js service-role client, never by
-- the browser client. Revoke from both anon and authenticated.
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text)               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_verification_token(uuid)        FROM anon, authenticated;

-- Old 9-arg resubmit_journal overload: dead code — revoke from everyone.
-- Note: if this function does not exist in the DB this is a no-op.
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.resubmit_journal(uuid, text, text, text, text, text, text, text, int) FROM anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ============================================================
-- 12. VERIFICATION
-- ============================================================
-- After COMMIT, run these manually to confirm correctness:
--
-- 1. Root admin intact:
--    SELECT id, name, email, role, status, is_permanent FROM public.profiles
--    WHERE email = 'nirmala.scienceandsociety@gmail.com';
--
-- 2. Cron job scheduled:
--    SELECT * FROM cron.job WHERE jobname = 'delete-expired-accounts';
--
-- 3. View accessible to anon (should return 't'):
--    SELECT has_table_privilege('anon', 'public.published_issues', 'SELECT');
--
-- 4. Confirm published_issues view returns rows (should show published papers):
--    SET ROLE anon; SELECT count(*) FROM public.published_issues; RESET ROLE;
--
-- 5. Confirm trigger functions cannot be called directly by authenticated users:
--    SELECT has_function_privilege('authenticated', 'public.enforce_profile_role_integrity()', 'EXECUTE');
--    -- Expected: f

-- ============================================================
-- 13. ASSIGN REVIEWER RPC (Moved to section 16a)
-- ============================================================

-- ============================================================
-- 14. ADMIN JOURNALS POLICY WITH CHECK (B-6 Fix)
-- ============================================================
DROP POLICY IF EXISTS "Admins can update journals" ON public.journals;
CREATE POLICY "Admins can update journals" ON public.journals FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    -- Prevent authorship reassignment
    AND student_id = (SELECT student_id FROM public.journals WHERE id = journals.id)
  );

-- ============================================================
-- 15. NOTIFICATIONS ADDITIONS: METADATA & DELETE
-- ============================================================
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications
  FOR DELETE USING ((select auth.uid()) = user_id);

-- ============================================================
-- 16. CORE EDITORIAL RPCs
-- (Merged from audit_fixes.sql — required for production editorial workflow)
-- These functions were previously only defined in audit_fixes.sql, which is
-- documented as a historical archive. They are now canonical here so that a
-- fresh install following the documented setup path produces a fully functional app.
-- ============================================================

-- 16a. Assign reviewer (with active-status guard + TOCTOU-safe atomic check)
CREATE OR REPLACE FUNCTION public.assign_reviewer_to_journal(
  p_journal_id uuid,
  p_reviewer_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_reviewer_id AND role = 'reviewer' AND status = 'active') THEN
    RAISE EXCEPTION 'Cannot assign: Selected user is not an active reviewer';
  END IF;
  -- Atomic check-and-insert (single transaction, no TOCTOU)
  IF EXISTS (SELECT 1 FROM public.assignments WHERE journal_id = p_journal_id FOR UPDATE) THEN
    RAISE EXCEPTION 'Journal already has a reviewer assigned';
  END IF;
  INSERT INTO public.assignments (journal_id, reviewer_id) VALUES (p_journal_id, p_reviewer_id);
  UPDATE public.journals SET status = 'under_review' WHERE id = p_journal_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assign_reviewer_to_journal(uuid, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.assign_reviewer_to_journal(uuid, uuid) TO authenticated;

-- 16b. Unpublish a published paper (reverts to accepted, clears publication metadata)
CREATE OR REPLACE FUNCTION public.unpublish_journal(
  p_journal_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF (SELECT status FROM public.journals WHERE id = p_journal_id) != 'published' THEN
    RAISE EXCEPTION 'Cannot unpublish: Journal is not currently published';
  END IF;
  UPDATE public.journals SET
    status = 'accepted',
    published_at = NULL,
    volume_number = NULL,
    issue_number = NULL
  WHERE id = p_journal_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.unpublish_journal(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.unpublish_journal(uuid) TO authenticated;

-- 16c. Admin editorial decision (accept / reject / rework) with status whitelist
CREATE OR REPLACE FUNCTION public.admin_make_decision(
  p_journal_id uuid,
  p_status text,
  p_admin_comments text,
  p_approval_proof_url text,
  p_revision_report_url text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_status NOT IN ('accepted', 'rejected', 'rework') THEN
    RAISE EXCEPTION 'Invalid decision status. Allowed: accepted, rejected, rework';
  END IF;
  IF (SELECT status FROM public.journals WHERE id = p_journal_id) = 'published' THEN
    RAISE EXCEPTION 'Cannot make decision: Journal is already published';
  END IF;
  UPDATE public.journals SET
    status = p_status,
    admin_comments = p_admin_comments,
    approval_proof_url = p_approval_proof_url,
    revision_report_url = p_revision_report_url
  WHERE id = p_journal_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_make_decision(uuid, text, text, text, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.admin_make_decision(uuid, text, text, text, text) TO authenticated;

-- 16d. Unassign reviewer (reverts journal to submitted if no reviewers remain)
CREATE OR REPLACE FUNCTION public.unassign_reviewer_from_journal(
  p_journal_id uuid,
  p_assignment_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM public.assignments WHERE id = p_assignment_id AND journal_id = p_journal_id;
  IF NOT EXISTS (SELECT 1 FROM public.assignments WHERE journal_id = p_journal_id) THEN
    UPDATE public.journals SET status = 'submitted' WHERE id = p_journal_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.unassign_reviewer_from_journal(uuid, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.unassign_reviewer_from_journal(uuid, uuid) TO authenticated;

-- 16e. Compile & publish a batch of accepted papers into a volume/issue
CREATE OR REPLACE FUNCTION public.admin_compile_issue(
  p_volume text,
  p_issue text,
  p_journal_ids uuid[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  -- Papers reach compile-eligible state as status='published' with volume_number IS NULL
  -- (set by publish_pre_compile). Reject anything not in that state.
  IF EXISTS (
    SELECT 1 FROM public.journals
    WHERE id = ANY(p_journal_ids)
      AND (status != 'published' OR volume_number IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Cannot compile issue: All selected journals must be in "Articles in Press" state (published with no volume assigned)';
  END IF;
  UPDATE public.journals SET
    volume_number = p_volume,
    issue_number = p_issue,
    status = 'published',
    published_at = now()
  WHERE id = ANY(p_journal_ids);
  UPDATE public.current_issue SET
    volume_number = p_volume,
    issue_number = p_issue
  WHERE id = 1;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_compile_issue(text, text, uuid[]) FROM public;
GRANT  EXECUTE ON FUNCTION public.admin_compile_issue(text, text, uuid[]) TO authenticated;


-- ============================================================
-- ADMIN PROMOTION RPC
-- ============================================================
-- NOTE: The correct promote_to_admin definition (restricted to is_permanent = true)
-- is defined at line ~471 above. The duplicate weaker definition that was here
-- (which allowed any active admin to promote) has been removed to prevent it
-- from silently overwriting the permanent-admin-only guard at runtime.
-- See audit finding C-1.

-- ============================================================
-- MISSING ADMIN RPCs (from schema.sql)
-- ============================================================
create or replace function public.ban_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Unauthorized';
  end if;

  if exists (select 1 from public.profiles where id = p_user_id and is_permanent = true) then
    raise exception 'Cannot ban the permanent admin account';
  end if;

  update public.profiles set status = 'inactive' where id = p_user_id;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.ban_user(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.ban_user(uuid) TO authenticated;

create or replace function public.unban_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Unauthorized';
  end if;

  select role into v_role from public.profiles where id = p_user_id;

  if v_role = 'reviewer' then
    update public.profiles set status = 'pending' where id = p_user_id;
  else
    update public.profiles set status = 'active' where id = p_user_id;
  end if;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.unban_user(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.unban_user(uuid) TO authenticated;

create or replace function public.delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Unauthorized';
  end if;

  -- Guard: never allow deletion of the permanent main admin account
  if exists (select 1 from public.profiles where id = target_user_id and is_permanent = true) then
    raise exception 'SECURITY EXCEPTION: The permanent main admin account cannot be deleted.';
  end if;

  -- Safe to delete — cascades to public.profiles
  delete from auth.users where id = target_user_id;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_user(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_user(uuid) TO authenticated;

-- ============================================================
-- PRE-COMPILE PUBLISH RPC (L-4)
-- ============================================================
-- Atomically transitions a journal from 'approved' to 'published' (Articles in Press)
-- with status-machine guard. Accepts full metadata so the update is atomic.
CREATE OR REPLACE FUNCTION public.publish_pre_compile(
  p_journal_id  uuid,
  p_abstract    text    DEFAULT NULL,
  p_keywords    text    DEFAULT NULL,
  p_authors     jsonb   DEFAULT NULL,
  p_author_name text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND status = 'active') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.journals WHERE id = p_journal_id AND status IN ('approved', 'accepted')) THEN
    RAISE EXCEPTION 'Journal must be in approved/accepted state before it can be published';
  END IF;

  UPDATE public.journals
  SET
    status        = 'published',
    published_at  = now(),
    volume_number = NULL,
    issue_number  = NULL,
    abstract      = COALESCE(p_abstract, abstract),
    keywords      = COALESCE(p_keywords, keywords),
    authors       = COALESCE(p_authors, authors),
    author_name   = COALESCE(p_author_name, author_name)
  WHERE id = p_journal_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.publish_pre_compile(uuid, text, text, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.publish_pre_compile(uuid, text, text, jsonb, text) TO authenticated;

-- ============================================================
-- AUDIT REMEDIATION PATCHES (H4, M5, M9)
-- ============================================================

-- M5 Fix: Add attempts tracking column to custom_otps table
ALTER TABLE public.custom_otps ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- SEC-B: OTP purpose segregation — prevents register/reset/email-change OTPs from
-- overwriting each other when the same email is used for multiple flows simultaneously.
-- The (email, purpose) pair is now the unique key instead of email alone.
ALTER TABLE public.custom_otps ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'register';

-- Drop old single-email unique constraint (if it exists) and replace with composite key.
-- We use DO block so the script is safe to re-run even after the index already exists.
DO $$ BEGIN
  -- Remove the old unique index on just email (may be named differently on different DBs)
  DROP INDEX IF EXISTS custom_otps_email_key;
  DROP INDEX IF EXISTS custom_otps_pkey; -- skip if pkey is on (email)
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS custom_otps_email_purpose ON public.custom_otps(email, purpose);

-- M9 Fix: Revoke direct client access to resubmit_journal RPC (Express backend owns resubmissions)
REVOKE EXECUTE ON FUNCTION public.resubmit_journal(uuid, text, text, text, text, text, text, text, text, int, jsonb, text) FROM public, anon, authenticated;

-- H4 Fix: Reviewer-safe assigned journals RPC (excludes PII / author identities)
CREATE OR REPLACE FUNCTION public.get_assigned_journals_for_reviewer()
RETURNS TABLE (
  id uuid,
  title text,
  abstract text,
  category text,
  keywords text,
  status text,
  created_at timestamptz,
  file_url text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    j.id,
    j.title,
    j.abstract,
    j.category,
    j.keywords,
    j.status,
    j.created_at,
    j.file_url
  FROM public.journals j
  JOIN public.assignments a ON a.journal_id = j.id
  WHERE a.reviewer_id = auth.uid();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_assigned_journals_for_reviewer() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_assigned_journals_for_reviewer() TO authenticated;


-- ============================================================
-- REVIEWER ACCEPT/REJECT WORKFLOW (2026-09-09)
-- Adds accepted_at column + RPCs for reviewer response and admin force-unassign
-- ============================================================

-- 1. Add accepted_at column to assignments (idempotent)
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS accepted_at timestamptz DEFAULT NULL;

-- 2. New RPC: reviewer_respond_to_assignment
-- Called by the reviewer to accept (accepted_at = now()) or reject (delete row)
CREATE OR REPLACE FUNCTION public.reviewer_respond_to_assignment(
  p_assignment_id uuid,
  p_accept        boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_journal_id uuid;
  v_prev_status text;
BEGIN
  -- Caller must be the reviewer of this assignment
  SELECT journal_id INTO v_journal_id
    FROM public.assignments
   WHERE id = p_assignment_id AND reviewer_id = auth.uid();

  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: assignment not found or not yours';
  END IF;

  IF p_accept THEN
    -- Mark as accepted
    UPDATE public.assignments SET accepted_at = now() WHERE id = p_assignment_id;
  ELSE
    -- Reject: delete assignment and revert journal status to its natural prior state
    -- Rework papers revert to 'rework'; all others revert to 'submitted'
    SELECT CASE WHEN resubmission_count > 0 THEN 'rework' ELSE 'submitted' END
      INTO v_prev_status
      FROM public.journals WHERE id = v_journal_id;

    DELETE FROM public.assignments WHERE id = p_assignment_id;
    UPDATE public.journals
       SET status = v_prev_status
     WHERE id = v_journal_id
       AND NOT EXISTS (SELECT 1 FROM public.assignments WHERE journal_id = v_journal_id);
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reviewer_respond_to_assignment(uuid, boolean) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.reviewer_respond_to_assignment(uuid, boolean) TO authenticated;

-- 3. Update unassign_reviewer_from_journal to block when reviewer has accepted
--    Use p_force=true for admin emergency override
CREATE OR REPLACE FUNCTION public.unassign_reviewer_from_journal(
  p_journal_id    uuid,
  p_assignment_id uuid,
  p_force         boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_accepted_at  timestamptz;
  v_prev_status  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT accepted_at INTO v_accepted_at
    FROM public.assignments
   WHERE id = p_assignment_id AND journal_id = p_journal_id;

  -- Block unassign if reviewer has accepted and force flag is not set
  IF v_accepted_at IS NOT NULL AND NOT p_force THEN
    RAISE EXCEPTION 'Reviewer has already accepted this assignment. Use force override to unassign.';
  END IF;

  -- Determine the correct revert status (rework papers go back to rework)
  SELECT CASE WHEN resubmission_count > 0 THEN 'rework' ELSE 'submitted' END
    INTO v_prev_status
    FROM public.journals WHERE id = p_journal_id;

  DELETE FROM public.assignments WHERE id = p_assignment_id AND journal_id = p_journal_id;
  IF NOT EXISTS (SELECT 1 FROM public.assignments WHERE journal_id = p_journal_id) THEN
    UPDATE public.journals SET status = v_prev_status WHERE id = p_journal_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.unassign_reviewer_from_journal(uuid, uuid, boolean) FROM public;
GRANT  EXECUTE ON FUNCTION public.unassign_reviewer_from_journal(uuid, uuid, boolean) TO authenticated;
-- Also keep the old 2-arg signature as a convenience wrapper (calls with force=false)
CREATE OR REPLACE FUNCTION public.unassign_reviewer_from_journal(
  p_journal_id    uuid,
  p_assignment_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.unassign_reviewer_from_journal(p_journal_id, p_assignment_id, false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.unassign_reviewer_from_journal(uuid, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.unassign_reviewer_from_journal(uuid, uuid) TO authenticated;

-- Atomic RPC function to increment views safely
CREATE OR REPLACE FUNCTION public.increment_paper_views(p_journal_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.journals
  SET views_count = COALESCE(views_count, 0) + 1
  WHERE id = p_journal_id AND status = 'published';
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_paper_views(UUID) TO anon, authenticated, service_role;

COMMIT;


