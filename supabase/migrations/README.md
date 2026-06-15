# supabase/migrations — conventions

## How migrations work in this repo

Migrations are applied **manually** via the Supabase MCP (`apply_migration` tool), against the single shared project `reelready` (`vrhmaeywqsohlztoouxu`). That project is shared across prod, staging, and dev (cost decision).

There is **no `supabase db push`** and no auto-apply. `scripts/doctor.ts` only counts local files — it does not query what is actually applied to prod. The ground truth for applied state is Supabase's `list_migrations` response.

DDL must be **idempotent**: use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS` then re-add, and `CREATE INDEX IF NOT EXISTS`. This ensures a file can be re-applied under a renamed prefix without damage.

## Parallel-session hazard: prefix collisions

Oliver runs multiple sessions concurrently. Sessions independently pick the next available `NNN_` prefix, causing filename collisions across branches before they merge. Two concrete examples that have already happened (as of 2026-06-15):

- `088_delivery_photo_selection_checkpoint` (PR #120 branch) and `088_cost_events_unit_type_characters` (harden/front-reaper branch) both claimed prefix `088`. The latter was renamed to `089` at merge time. Prod history recorded it under the pre-rename name `088_cost_events_unit_type_characters`.
- `084_le_video` and `084_scenes_provider_preference` are an intentional pre-existing duplicate — both applied, both named `084`.

**Supabase history keys on a timestamp version**, not the filename prefix, so the applied state never collides even when filenames do. The drift is cosmetic — but it makes `PROJECT-STATE.md`'s migration table drift from prod reality.

### Convention going forward

1. **Claim the prefix late** — pick your `NNN_` number just before pushing/merging to `main`, not at branch-creation time. Check `git log origin/main -- supabase/migrations/` to see the highest prefix already on main.
2. **Write idempotent DDL** (see above). Then if a file gets renamed at merge, re-applying it under the new name is harmless.
3. **After any parallel-session merge**, check `git log origin/<branch>..HEAD` for stranded commits and reconcile `docs/state/PROJECT-STATE.md`'s migration table against `list_migrations`.
4. **Update `PROJECT-STATE.md`** whenever you apply a migration — record the applied date, the prod-history name, and any name-vs-filename drift.

## Known drift as of 2026-06-15

| Situation | Detail |
|---|---|
| `088_delivery_photo_selection_checkpoint` | File on `main`; **not applied to prod** — owner-gated, different session. |
| `088a_ally_seo_job_kind`, `088b_ally_seo_tables`, `089_ally_core` | Applied to prod 2026-06-14/15 via MCP; SQL files are on the unmerged `ally` branch, not yet on `main`. |
| `089_cost_events_unit_type_characters` (repo filename) | Applied to prod under legacy name `088_cost_events_unit_type_characters`; renumbered at merge to avoid colliding with 088_delivery_photo. Constraint verified live. |
