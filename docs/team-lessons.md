# Team lessons (auto-appended by gate fix-loops)

Mistakes caught by the verify gates in THIS repo. Every seat reads this before working. Append, never rewrite history.

## 2026-06-11 — branch reverted main's test fixes (stale-base test files)

On `feat/market-update-workflow`, two test files were edited from a stale base and silently undid fixes that already existed on `origin/main`:

- `api/admin/studio/__tests__/ingest.test.ts` — main's `vi.mock` used the `importOriginal` pattern so the real `stringifyDbError` stayed available to the handler; the branch replaced it with a bare factory exporting only `manualIngest`, so vitest strict mocking threw `No "stringifyDbError" export is defined on the mock` in every test reaching the catch block (4 failures). Main's extra `video_type` passthrough test was also dropped.
- `src/v2/components/landing/MarketComparison.test.tsx` — main used `getAllByText(/Win more listings/i)` (text renders twice) and had removed the stale `The math` assertion (PricingCalculator archived 2026-04-21); the branch reverted to `getByText` + re-added the dead assertion (1 failure).

**Lesson:** before editing a test file on a feature branch, diff it against `origin/main` first (`git diff origin/main -- <file>`). If the branch's copy is older than main's, restore main's version and apply your change on top — never re-type a test from memory of an old checkout. Production code was correct in both cases; only the tests were wrong.

## Tracked pre-existing debt (not regressions — verified present on origin/main)

`tsc -p tsconfig.app.json --noEmit` reports 23 pre-existing errors on main in files untouched by feature branches, including: `src/pages/dashboard/PromptLab.tsx` (missing `SkuChoice` keys `kling-v3-pro` / `seedance-pro-pushin` / `veo-3-1-preview` in cost+label maps; stale `.tier` access), `src/pages/dashboard/Settings.tsx` (4x `Dispatch<SetStateAction<…>>` vs `(v: string) => void`), `src/pages/Upload.tsx` (`sqft` not a known property), plus AddressAutocomplete, EmailDesigner, labModels, Finances, Pipeline, BlogPostsList and 3 test files. Vercel's build does not run tsc, so these don't block deploys — but new errors hide among them. When touching one of these files, fix its errors as part of the change. Note: the root `tsconfig.json` is a solution file (`files: []`) — a bare `tsc --noEmit` checks NOTHING and reports 0 errors; always use `-p tsconfig.app.json` (or `-b`).
