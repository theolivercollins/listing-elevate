/**
 * scripts/autonomy/config.ts
 *
 * Repo-agnostic config loader for the autonomy module.
 *
 * Resolution order:
 *   1. <repoRoot>/.autonomy/config.json   — project-local overrides
 *   2. docs/autonomy/config.example.json  — ships with the repo as a template
 *   3. Hardcoded defaults below           — last-resort baseline
 *
 * The three sources are deep-merged: project-local wins over example,
 * example wins over defaults. Only scalar leaves are replaced; objects
 * are merged one level deep (sub-object keys, not nested further).
 *
 * After merging, required keys are validated and telegram.envFile is
 * expanded if it starts with "~/".
 *
 * IMPORTANT: autonomy.unattended / autoCommit / autoMerge all default
 * false. Autonomy is inert until explicitly armed in config.json.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Public contract — other autonomy modules import this type
// ---------------------------------------------------------------------------

export interface AutonomyConfig {
  /** Human-readable project name, used in Telegram messages and log headers. */
  project: string;

  /** Shell commands that constitute the CI gate for a commit to be acceptable. */
  gates: {
    typecheck: string;
    lint: string;
    build: string;
    test: string;
  };

  /** Path (relative to repoRoot) to the Markdown file listing active goals. */
  goalsFile: string;

  /** Path (relative to repoRoot) to the directory where autonomy state files live. */
  stateDir: string;

  /** Telegram notification channel config. */
  telegram: {
    /** The Telegram chat/channel ID that receives notifications. */
    chatId: string;
    /**
     * Path to a .env file that contains TELEGRAM_BOT_TOKEN.
     * A leading "~/" is expanded to the home directory at load time.
     */
    envFile: string;
  };

  /** Configuration for the refuter agent that challenges proposed changes. */
  refuter: {
    /** When false the refuter step is skipped entirely. */
    enabled: boolean;
    /** Model identifier passed to the provider (e.g. "openai/gpt-4o"). */
    model: string;
    /** Provider routing. Only "openrouter" is currently supported. */
    via: "openrouter";
  };

  /**
   * Master autonomy flags — ALL default false.
   * Set these to true in .autonomy/config.json only when deliberately arming
   * unattended operation. Never commit them as true in shared config.
   */
  autonomy: {
    /** When true, the loop runs without pausing for human confirmation. */
    unattended: boolean;
    /** When true, passing commits are pushed without a human go-ahead. */
    autoCommit: boolean;
    /** When true, passing PRs are merged without a human go-ahead. */
    autoMerge: boolean;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Thin wrapper for JSON.parse that surfaces the file path on error.
 */
function parseJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(
      `autonomy/config: failed to parse ${filePath}: ${(err as Error).message}`,
    );
  }
}

/**
 * Deep-merge two plain objects one level deep (sub-objects are merged by key;
 * scalars and arrays are replaced wholesale). `override` wins over `base`.
 * Neither argument is mutated.
 */
function shallowDeepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof base[key] === "object" &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      result[key] = {
        ...(base[key] as Record<string, unknown>),
        ...(val as Record<string, unknown>),
      };
    } else {
      result[key] = val;
    }
  }
  return result;
}

/** Expand a leading "~/" to the OS home directory. */
function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: AutonomyConfig = {
  project: "",
  gates: {
    // pnpm typecheck:baseline is the count-aware baseline gate that lives on
    // main. If that script is absent from package.json, fall back to:
    //   pnpm exec tsc --noEmit
    // See docs/autonomy/config.md §gates.typecheck for details.
    typecheck: "pnpm typecheck:baseline",
    lint: "pnpm run lint",
    build: "pnpm run build",
    test: "pnpm run test",
  },
  goalsFile: ".autonomy/goals.md",
  stateDir: ".autonomy/state",
  telegram: {
    chatId: "",
    envFile: "~/.claude/channels/telegram/.env",
  },
  refuter: {
    enabled: false,
    model: "openai/gpt-4o",
    via: "openrouter",
  },
  // CRITICAL: all autonomy flags default false — loop is inert until armed.
  autonomy: {
    unattended: false,
    autoCommit: false,
    autoMerge: false,
  },
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationError {
  field: string;
  reason: string;
}

function validateConfig(cfg: AutonomyConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!cfg.project || typeof cfg.project !== "string") {
    errors.push({ field: "project", reason: "must be a non-empty string" });
  }

  const gateKeys = ["typecheck", "lint", "build", "test"] as const;
  for (const k of gateKeys) {
    if (!cfg.gates[k] || typeof cfg.gates[k] !== "string") {
      errors.push({
        field: `gates.${k}`,
        reason: "must be a non-empty shell command string",
      });
    }
  }

  if (!cfg.goalsFile || typeof cfg.goalsFile !== "string") {
    errors.push({ field: "goalsFile", reason: "must be a non-empty string" });
  }

  if (!cfg.stateDir || typeof cfg.stateDir !== "string") {
    errors.push({ field: "stateDir", reason: "must be a non-empty string" });
  }

  if (!cfg.telegram.chatId || typeof cfg.telegram.chatId !== "string") {
    errors.push({
      field: "telegram.chatId",
      reason: "must be a non-empty string",
    });
  }

  if (!cfg.telegram.envFile || typeof cfg.telegram.envFile !== "string") {
    errors.push({
      field: "telegram.envFile",
      reason: "must be a non-empty string",
    });
  }

  if (cfg.refuter.via !== "openrouter") {
    errors.push({
      field: "refuter.via",
      reason: 'only "openrouter" is supported',
    });
  }

  if (!cfg.refuter.model || typeof cfg.refuter.model !== "string") {
    errors.push({
      field: "refuter.model",
      reason: "must be a non-empty string",
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and return the merged, validated AutonomyConfig.
 *
 * @param repoRoot - Absolute path to the repository root. Defaults to
 *   `process.cwd()` when omitted. Must be an absolute path.
 */
export function loadConfig(repoRoot: string = process.cwd()): AutonomyConfig {
  // Start from hardcoded defaults.
  let merged: Record<string, unknown> = { ...(DEFAULTS as unknown as Record<string, unknown>) };

  // Layer 1: example config ships with the repo and acts as a documented template.
  const examplePath = path.join(repoRoot, "docs", "autonomy", "config.example.json");
  if (fs.existsSync(examplePath)) {
    const example = parseJsonFile(examplePath);
    if (typeof example === "object" && example !== null) {
      merged = shallowDeepMerge(merged, example as Record<string, unknown>);
    }
  }

  // Layer 2: project-local overrides (gitignored, never committed).
  const localPath = path.join(repoRoot, ".autonomy", "config.json");
  if (fs.existsSync(localPath)) {
    const local = parseJsonFile(localPath);
    if (typeof local === "object" && local !== null) {
      merged = shallowDeepMerge(merged, local as Record<string, unknown>);
    }
  }

  // Cast to AutonomyConfig — we validate immediately after.
  const cfg = merged as unknown as AutonomyConfig;

  // Expand "~/" in telegram.envFile before validation so the validator sees
  // the real path (prevents false "empty" errors on paths like "~/...").
  if (typeof cfg.telegram?.envFile === "string") {
    cfg.telegram.envFile = expandHome(cfg.telegram.envFile);
  }

  // Ensure autonomy booleans are always booleans, never truthy strings from JSON.
  cfg.autonomy = {
    unattended: cfg.autonomy?.unattended === true,
    autoCommit: cfg.autonomy?.autoCommit === true,
    autoMerge: cfg.autonomy?.autoMerge === true,
  };

  const errors = validateConfig(cfg);
  if (errors.length > 0) {
    const lines = errors.map((e) => `  • ${e.field}: ${e.reason}`).join("\n");
    throw new Error(
      `autonomy/config: invalid configuration — ${errors.length} error(s):\n${lines}\n` +
        `  Config sources checked:\n` +
        `    ${localPath} (${fs.existsSync(localPath) ? "found" : "not found"})\n` +
        `    ${examplePath} (${fs.existsSync(examplePath) ? "found" : "not found"})`,
    );
  }

  // Resolve goalsFile and stateDir to absolute paths against the resolved repoRoot
  // so callers never need to re-join against process.cwd() and the paths stay
  // consistent regardless of which directory the script is invoked from.
  if (!path.isAbsolute(cfg.goalsFile)) {
    cfg.goalsFile = path.join(repoRoot, cfg.goalsFile);
  }
  if (!path.isAbsolute(cfg.stateDir)) {
    cfg.stateDir = path.join(repoRoot, cfg.stateDir);
  }

  return cfg;
}
