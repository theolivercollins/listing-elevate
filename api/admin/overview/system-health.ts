import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import type { SystemHealthStatus } from "../../../lib/types.js";

// GET /api/admin/overview/system-health
//
// Aggregates three signals to produce a single status pill + alerts list:
//   1. system_flags — any kill-switch in an unexpected state
//   2. cost_events — provider error rate over last 24h (>5% critical, >1% degraded)
//   3. properties — stuck in any non-terminal status (>60min critical, >15min degraded)
//
// Conservative ordering: critical wins over degraded wins over healthy.

const SINCE_24H = () => new Date(Date.now() - 86_400_000).toISOString();
const STUCK_DEGRADED_MIN_MS = 15 * 60_000;
const STUCK_CRITICAL_MIN_MS = 60 * 60_000;
const TERMINAL_STATES = new Set(["complete", "failed", "archived"]);

const EXPECTED_FLAGS: Record<string, string | boolean> = {
  // judge_cron_paused is currently expected ON per HANDOFF 2026-05-13
  judge_cron_paused: true,
};

function escalate(current: SystemHealthStatus, next: SystemHealthStatus): SystemHealthStatus {
  const rank: Record<SystemHealthStatus, number> = { healthy: 0, degraded: 1, critical: 2 };
  return rank[next] > rank[current] ? next : current;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabase();
  const alerts: Array<{
    id: string;
    severity: "degraded" | "critical";
    category: "kill_switch" | "provider_error_rate" | "stuck_property";
    message: string;
    detail?: string;
  }> = [];
  let status: SystemHealthStatus = "healthy";

  // 1) Kill-switches
  const { data: flags, error: flagErr } = await supabase
    .from("system_flags")
    .select("name, value");
  if (flagErr) return res.status(500).json({ error: flagErr.message });

  for (const row of flags ?? []) {
    const expected = EXPECTED_FLAGS[row.name];
    if (expected === undefined) continue; // unknown flag — don't alert
    if (row.value !== expected) {
      alerts.push({
        id: `flag:${row.name}`,
        severity: "degraded",
        category: "kill_switch",
        message: `Kill-switch '${row.name}' is ${String(row.value)} (expected ${String(expected)})`,
      });
      status = escalate(status, "degraded");
    }
  }

  // 2) Provider error rate over last 24h
  const { data: events24h, error: eErr } = await supabase
    .from("cost_events")
    .select("provider, metadata, created_at")
    .gte("created_at", SINCE_24H())
    .limit(2000);
  if (eErr) return res.status(500).json({ error: eErr.message });

  const perProvider = new Map<string, { total: number; errors: number }>();
  for (const evt of events24h ?? []) {
    const p = (evt.provider as string) ?? "unknown";
    if (!perProvider.has(p)) perProvider.set(p, { total: 0, errors: 0 });
    const bucket = perProvider.get(p)!;
    bucket.total += 1;
    const meta = evt.metadata as Record<string, unknown> | null;
    if (meta && (meta.error || meta.failed === true)) bucket.errors += 1;
  }

  for (const [provider, { total, errors }] of perProvider) {
    if (total < 5) continue; // not enough sample — don't alarm
    const rate = errors / total;
    if (rate > 0.05) {
      alerts.push({
        id: `err:${provider}`,
        severity: "critical",
        category: "provider_error_rate",
        message: `${provider} error rate ${(rate * 100).toFixed(1)}% over last 24h`,
        detail: `${errors} errors in ${total} calls`,
      });
      status = escalate(status, "critical");
    } else if (rate > 0.01) {
      alerts.push({
        id: `err:${provider}`,
        severity: "degraded",
        category: "provider_error_rate",
        message: `${provider} error rate ${(rate * 100).toFixed(1)}% over last 24h`,
        detail: `${errors} errors in ${total} calls`,
      });
      status = escalate(status, "degraded");
    }
  }

  // 3) Stuck properties
  const { data: props, error: pErr } = await supabase
    .from("properties")
    .select("id, status, updated_at, address")
    .not("status", "in", `(${Array.from(TERMINAL_STATES).map((s) => `"${s}"`).join(",")})`);
  if (pErr) return res.status(500).json({ error: pErr.message });

  const now = Date.now();
  for (const prop of props ?? []) {
    if (TERMINAL_STATES.has(prop.status as string)) continue;
    const updated = new Date(prop.updated_at as string).getTime();
    if (Number.isNaN(updated)) continue;
    const ageMs = now - updated;
    if (ageMs > STUCK_CRITICAL_MIN_MS) {
      alerts.push({
        id: `stuck:${prop.id}`,
        severity: "critical",
        category: "stuck_property",
        message: `Listing stuck at status='${prop.status}' for ${Math.round(ageMs / 60_000)}min`,
        detail: prop.address as string,
      });
      status = escalate(status, "critical");
    } else if (ageMs > STUCK_DEGRADED_MIN_MS) {
      alerts.push({
        id: `stuck:${prop.id}`,
        severity: "degraded",
        category: "stuck_property",
        message: `Listing stuck at status='${prop.status}' for ${Math.round(ageMs / 60_000)}min`,
        detail: prop.address as string,
      });
      status = escalate(status, "degraded");
    }
  }

  return res.status(200).json({
    status,
    alert_count: alerts.length,
    alerts,
    generated_at: new Date().toISOString(),
  });
}
