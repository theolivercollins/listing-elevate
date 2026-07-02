-- 092: Persist assembly render job tokens on delivery_runs for idempotent resume.
--
-- When the Vercel cron function is killed mid-poll (common for both/30-s renders —
-- two 240-s polls can exceed any function budget), the stored job ID lets the
-- next sweep tick RESUME polling the existing job rather than submitting a new
-- Creatomate render (which would double-spend). Each column stores the full
-- AssemblyJob shape: { jobId: text, environment: "stage"|"v1" }.
--
-- Written by autopilot pipeline after job submission; cleared to NULL when the
-- render finishes (URL written to properties). A non-null value on an
-- auto_run=true stage='assembling' run signals the reaper to resume polling.
--
-- NOT APPLIED — apply to dev first, then staging, then prod.
-- ROLLBACK: alter table delivery_runs drop column if exists assembly_h_job, drop column if exists assembly_v_job;

alter table delivery_runs
  add column if not exists assembly_h_job jsonb,
  add column if not exists assembly_v_job jsonb;

comment on column delivery_runs.assembly_h_job is
  'In-flight or last horizontal render job {jobId, environment} — persisted after submit, cleared on completion. Allows sweep to resume polling without re-spend.';

comment on column delivery_runs.assembly_v_job is
  'In-flight or last vertical render job {jobId, environment} — same semantics as assembly_h_job.';
