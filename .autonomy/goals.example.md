# Goals — example file

This file is read by `scripts/autonomy/planner.ts` and the planner skill.
Copy it to `.autonomy/goals.md` and edit to suit the current week.
Delete or archive completed sections.

---

## Weekly

Goals that apply to any day this week — background context for the planner.

- Keep `cost_events` reconciled: every new API call (Anthropic, Kling, Runway, Luma, Shotstack) must write a cost_events row within 5 s of the call
- No JetBrains Mono / monospace in UI — all text stays on `--le-font-sans` (Inter)
- Bunny for all video and file storage; never Supabase Storage

---

## 2026-06-19

- Fix Kling cost tracking: the `/api/render/kling` route calls the Kling API but never writes to `cost_events`; add the insert and cover it with a unit test
  - Affected files: `src/app/api/render/kling/route.ts`, `src/lib/providers/kling.ts`
- Bump `@anthropic-ai/sdk` to latest patch and verify `tsc --noEmit` stays clean

---

## 2026-06-20

- Add `GET /api/properties/[id]/scenes` route: returns the ordered scene list for a property as JSON; must be authenticated (Supabase session cookie)
  - Acceptance: 200 with `{ scenes: Scene[] }` for an owned property; 404 for unknown; 401 for unauthenticated

---

<!-- Flat-list example (no day sections) — uncomment to use Structure A:

- Audit all `console.log` statements in `src/app/api/` and replace with the logger utility
- Add a Telegram notification when a render pipeline run completes (success or failure)
- Refactor `src/lib/providers/` to use a shared retry wrapper instead of duplicated catch blocks

-->
