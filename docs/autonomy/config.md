# Autonomy module — configuration reference

All configuration lives in `.autonomy/config.json` at the repo root (gitignored;
never committed). At startup `loadConfig()` deep-merges three sources in order:

1. Hardcoded defaults in `scripts/autonomy/config.ts`
2. `docs/autonomy/config.example.json` (the template, committed to the repo)
3. `.autonomy/config.json` (your local overrides — the winner)

Each source only needs to supply the keys it wants to change; missing keys
fall through to the layer below.

---

## Top-level keys

### `project` — string (required)

Human-readable project name. Appears in Telegram notifications and log headers.

```json
"project": "listing-elevate"
```

---

### `gates` — object (required)

Shell commands that define the CI gate. Each command is run in the repo root.
A non-zero exit from any gate aborts the current autonomy cycle.

| Key | Default | Notes |
|---|---|---|
| `typecheck` | `"pnpm typecheck:baseline"` | Count-aware baseline gate (see below) |
| `lint` | `"pnpm run lint"` | |
| `build` | `"pnpm run build"` | |
| `test` | `"pnpm run test"` | |

**`gates.typecheck` detail:** the default `pnpm typecheck:baseline` runs the
repo's count-aware baseline script, which compares the current error count
against a stored baseline and fails only when errors increase. If that script
is absent from `package.json` (e.g. in a fresh clone or a different project),
fall back to:

```json
"typecheck": "pnpm exec tsc --noEmit"
```

The plain `tsc --noEmit` form fails on any type error; the baseline form
tolerates a pre-existing error budget. Use whichever is appropriate for the
repo's current state of type hygiene.

---

### `goalsFile` — string

Path relative to the repo root that points to the Markdown file listing
active autonomy goals. Each goal is a top-level `##` section.

Default: `".autonomy/goals.md"`

---

### `stateDir` — string

Path relative to the repo root where the autonomy module writes state files
(cycle log, last-run timestamp, goal progress). File-based only — no database.

Default: `".autonomy/state"`

---

### `telegram` — object

| Key | Default | Notes |
|---|---|---|
| `chatId` | `""` (required) | Telegram chat or channel ID |
| `envFile` | `"~/.claude/channels/telegram/.env"` | Path to a file containing `TELEGRAM_BOT_TOKEN` |

`envFile` may start with `~/`; the loader expands it to `$HOME` at startup.

---

### `refuter` — object

The refuter agent independently challenges a proposed change before it is
committed, acting as an automated skeptic.

| Key | Default | Notes |
|---|---|---|
| `enabled` | `false` | Set to `true` to enable the refuter step |
| `model` | `"openai/gpt-4o"` | Model identifier passed to the provider |
| `via` | `"openrouter"` | Routing provider; only `"openrouter"` is supported |

When `enabled` is `false` the refuter step is skipped and the cycle proceeds
directly from gate-check to commit proposal.

---

### `autonomy` — object

**All three flags default `false`. The loop is inert until you explicitly arm it.**

Setting any flag to `true` in `.autonomy/config.json` (never in the committed
example) enables that behaviour for local unattended runs.

| Key | Default | Meaning when `true` |
|---|---|---|
| `unattended` | `false` | Loop runs without pausing for human confirmation at each cycle |
| `autoCommit` | `false` | Commits that pass all gates are pushed without a human go-ahead |
| `autoMerge` | `false` | PRs that pass all gates are merged without a human go-ahead |

Do not commit these flags as `true` — they are intentionally omitted from
`config.example.json` (where all three appear as `false`) so that a fresh
checkout is always safe-by-default.

---

## Minimal local override example

Create `.autonomy/config.json` with only the keys you want to change:

```json
{
  "telegram": {
    "chatId": "YOUR_CHAT_ID"
  },
  "autonomy": {
    "unattended": true,
    "autoCommit": true
  }
}
```

Everything else inherits from the example and the defaults.
