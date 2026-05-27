-- Migration 077: drop gen2_pair_labels.candidate_id FK to gen2_pair_candidates.
--
-- Candidates are generated in-memory by pair-queue's rule-generator and never
-- persisted to gen2_pair_candidates. Labels reference candidate_id for
-- informational/training purposes only. The FK was blocking every real label
-- POST with "violates foreign key constraint" 500.
--
-- Applied to remote project vrhmaeywqsohlztoouxu via Supabase MCP.

ALTER TABLE public.gen2_pair_labels DROP CONSTRAINT IF EXISTS gen2_pair_labels_candidate_id_fkey;

NOTIFY pgrst, 'reload schema';
