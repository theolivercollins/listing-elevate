// Synthetic fallback data — modeled on the production data shapes
// (properties, scenes, pipeline stages, providers, daily stats).
// Used whenever the live API returns no rows so the dashboard always
// renders with realistic-looking content.

export interface SampleProperty {
  id: string;
  address: string;
  status: string;
  photos: number;
  scenes: number;
  cost: number; // cents
  duration_ms: number | null;
  agent: string;
  created_at: number;
  progress: number;
  thumb_hue: number;
}

export interface SampleStage {
  key: string;
  label: string;
  short: string;
}

export interface SampleDaily {
  date: string;
  cost: number; // cents
  videos: number;
  sla: number;
}

export interface SampleAgent {
  name: string;
  company: string;
  videos: number;
  spend: number; // cents
}

export interface SampleReviewScene {
  id: string;
  property: string;
  scene_number: number;
  status: string;
  confidence: number;
  provider: string;
  prompt: string;
  issues: string[];
}

export interface SampleActivity {
  kind: "complete" | "review" | "provider" | "upload" | "cost";
  title: string;
  sub: string;
  time: string;
}

export const SAMPLE_STAGES: SampleStage[] = [
  { key: "queued", label: "Queued", short: "01" },
  { key: "ingesting", label: "Ingesting", short: "02" },
  { key: "analyzing", label: "Analyzing", short: "03" },
  { key: "scripting", label: "Scripting", short: "04" },
  { key: "generating", label: "Generating", short: "05" },
  { key: "qc", label: "QC", short: "06" },
  { key: "assembling", label: "Assembling", short: "07" },
];

const ADDRESSES = [
  "412 Sycamore Lane, Brookline MA",
  "88 Harbor Pointe Dr, Sausalito CA",
  "2304 Magnolia St, Charleston SC",
  "17 West End Ave #14B, New York NY",
  "9540 Vista Verde, Scottsdale AZ",
  "611 Pine Ridge Rd, Aspen CO",
  "3201 Bayshore Blvd, Tampa FL",
  "120 Greenwich St #34, New York NY",
  "55 Pelican Cove, Naples FL",
  "1410 Beacon Hill, Boston MA",
  "744 Coastline Way, Malibu CA",
  "29 Willow Creek Ln, Boulder CO",
  "8081 Camelback Heights, Phoenix AZ",
  "550 Pacific Coast Hwy, Laguna Beach CA",
  "12 Heritage Sq, Savannah GA",
];

export const SAMPLE_AGENTS: SampleAgent[] = [
  { name: "Maya Lindqvist", company: "Atlas Realty", videos: 142, spend: 21840000 },
  { name: "Oliver Whitfield", company: "Pinnacle Group", videos: 96, spend: 18425000 },
  { name: "Camille Reyes", company: "Coastline Co.", videos: 81, spend: 13490000 },
  { name: "Jens Halvorsen", company: "Northstar Homes", videos: 64, spend: 10260000 },
  { name: "Ava Chen", company: "Vista Realty", videos: 47, spend: 8420000 },
];

function makeProperties(): SampleProperty[] {
  const statuses = [
    "complete",
    "complete",
    "complete",
    "generating",
    "analyzing",
    "scripting",
    "qc",
    "queued",
    "ingesting",
    "assembling",
    "complete",
    "generating",
    "needs_review",
    "complete",
    "generating",
  ];
  const stageProgress: Record<string, number> = {
    queued: 4,
    ingesting: 14,
    analyzing: 26,
    scripting: 42,
    generating: 64,
    qc: 82,
    assembling: 94,
    complete: 100,
    needs_review: 80,
  };
  return ADDRESSES.map((address, i) => {
    const status = statuses[i] ?? "complete";
    return {
      id: "sample_p_" + (1000 + i),
      address,
      status,
      photos: 18 + Math.floor(Math.sin(i * 1.7) * 6 + 6),
      scenes: 8,
      cost: 124000 + Math.floor((Math.sin(i * 2.1) + 1) * 90000),
      duration_ms: status === "complete" ? (38 * 60 + Math.floor(Math.sin(i * 1.3) * 900)) * 1000 : null,
      agent: SAMPLE_AGENTS[i % SAMPLE_AGENTS.length].name,
      created_at: Date.now() - i * 3600 * 1000 * ((i % 5) + 1),
      progress: stageProgress[status] ?? 0,
      thumb_hue: 200 + (i * 23) % 160,
    };
  });
}

export const SAMPLE_PROPERTIES: SampleProperty[] = makeProperties();

function makeDaily(): SampleDaily[] {
  const out: SampleDaily[] = [];
  for (let i = 13; i >= 0; i--) {
    const seed = Math.sin(i * 0.9) * 0.5 + Math.cos(i * 0.4) * 0.3 + 1;
    out.push({
      date: new Date(Date.now() - i * 86400000).toISOString().slice(5, 10),
      cost: Math.round(800000 + seed * 450000 + Math.sin(i * 1.9) * 110000),
      videos: Math.max(2, Math.round(8 + seed * 5 + Math.sin(i * 1.7) * 2)),
      sla: Math.round(82 + Math.sin(i * 0.5) * 8),
    });
  }
  return out;
}

export const SAMPLE_DAILY: SampleDaily[] = makeDaily();

export const SAMPLE_REVIEW_SCENES: SampleReviewScene[] = [
  {
    id: "s_2401",
    property: "9540 Vista Verde, Scottsdale AZ",
    scene_number: 4,
    status: "qc_soft_reject",
    confidence: 0.68,
    provider: "kling",
    prompt:
      "Cinematic slow dolly across the master bedroom, golden hour light pouring through the south-facing window, focus on the four-poster bed.",
    issues: ["Window blowout in upper third", "Texture artifacts on bed linen"],
  },
  {
    id: "s_2402",
    property: "412 Sycamore Lane, Brookline MA",
    scene_number: 7,
    status: "qc_hard_reject",
    confidence: 0.41,
    provider: "runway",
    prompt: "Sweeping crane shot rising above the backyard pool, revealing the surrounding gardens.",
    issues: ["Pool water animation broken", "Vegetation flickering"],
  },
];

export const SAMPLE_ACTIVITY: SampleActivity[] = [
  { kind: "complete", title: "Video delivered", sub: "120 Greenwich St #34", time: "2m" },
  { kind: "review", title: "Manual review queued", sub: "9540 Vista Verde · Scene 4", time: "6m" },
  { kind: "provider", title: "Kling failover → Runway", sub: "412 Sycamore · Scene 7", time: "9m" },
  { kind: "upload", title: "New listing intake", sub: "55 Pelican Cove · 24 photos", time: "14m" },
  { kind: "cost", title: "Cost threshold cleared", sub: "Daily ceiling 92% reached", time: "21m" },
  { kind: "complete", title: "Video delivered", sub: "744 Coastline Way", time: "38m" },
];

export const SAMPLE_PROVIDER_MIX = [
  { provider: "Runway Gen-4", value: 42 },
  { provider: "Kling 2.0", value: 28 },
  { provider: "Luma Ray2", value: 18 },
  { provider: "Anthropic", value: 8 },
  { provider: "Other", value: 4 },
];

export const SAMPLE_FINANCE_ROWS = [
  { provider: "Runway Gen-4", today: 284000, week: 1842000, month: 7124000, events: 412, share: 38 },
  { provider: "Kling 2.0", today: 182000, week: 1421000, month: 5683000, events: 380, share: 30 },
  { provider: "Luma Ray2", today: 112000, week: 823000, month: 3240000, events: 220, share: 17 },
  { provider: "Anthropic", today: 48000, week: 342000, month: 1482000, events: 1842, share: 8 },
  { provider: "Gemini", today: 24000, week: 182000, month: 724000, events: 980, share: 4 },
  { provider: "Shotstack", today: 18000, week: 114000, month: 486000, events: 156, share: 3 },
];

export const SAMPLE_LOG_LINES = [
  { ts: "14:28:42", level: "info" as const, source: "pipeline", msg: "Property p_1234 advanced to stage `generating`" },
  { ts: "14:28:38", level: "info" as const, source: "router", msg: "Routing scene s_9821 to runway (kling exhausted retries)" },
  { ts: "14:28:32", level: "warn" as const, source: "qc", msg: "Soft-reject on s_2401 — confidence 0.68, issues: window blowout" },
  { ts: "14:28:21", level: "info" as const, source: "pipeline", msg: "Director plan committed for p_1232 (8 scenes)" },
  { ts: "14:28:14", level: "info" as const, source: "intake", msg: "Photo analysis complete: 24 photos · 4 rooms · 2 exteriors" },
  { ts: "14:28:02", level: "info" as const, source: "router", msg: "Bucket `bedroom-master` → kling (router score 0.94)" },
  { ts: "14:27:54", level: "error" as const, source: "kling", msg: "API 502 from kling-api.com — failover triggered" },
  { ts: "14:27:48", level: "info" as const, source: "cron", msg: "Daily reconcile completed — drift 2.1%" },
  { ts: "14:27:31", level: "info" as const, source: "pipeline", msg: "Property p_1231 → `complete` (42m 18s, $8.40)" },
  { ts: "14:27:12", level: "info" as const, source: "intake", msg: "New property received: 412 Sycamore Lane" },
  { ts: "14:26:58", level: "info" as const, source: "assembly", msg: "Final cut ready: 38.4MB · 1080p · 12 scenes" },
  { ts: "14:26:42", level: "warn" as const, source: "judge", msg: "Judge confidence below threshold for s_2399 (0.71)" },
];

export const SAMPLE_SERVICES = [
  { name: "Pipeline orchestrator", status: "up" as const, latency: "42ms", uptime: "99.98%" },
  { name: "Anthropic API", status: "up" as const, latency: "240ms", uptime: "99.94%" },
  { name: "Runway Gen-4", status: "up" as const, latency: "1.2s", uptime: "99.91%" },
  { name: "Kling 2.0", status: "degraded" as const, latency: "3.4s", uptime: "99.62%" },
  { name: "Luma Ray2", status: "up" as const, latency: "980ms", uptime: "99.97%" },
  { name: "Shotstack", status: "up" as const, latency: "612ms", uptime: "99.99%" },
  { name: "Supabase", status: "up" as const, latency: "28ms", uptime: "99.99%" },
  { name: "Vercel functions", status: "up" as const, latency: "18ms", uptime: "99.98%" },
];

export const SAMPLE_USERS = [
  { name: "Oliver Collins", email: "oliver@recasi.com", role: "Admin", status: "active" as const, last: "2m ago", listings: 142, hue: 220 },
  { name: "Maya Lindqvist", email: "maya@atlas.com", role: "Agent", status: "active" as const, last: "18m ago", listings: 96, hue: 32 },
  { name: "Camille Reyes", email: "camille@coastline.co", role: "Agent", status: "active" as const, last: "1h ago", listings: 81, hue: 340 },
  { name: "Jens Halvorsen", email: "jens@northstar.com", role: "Agent", status: "active" as const, last: "3h ago", listings: 64, hue: 200 },
  { name: "Ava Chen", email: "ava@vistarealty.com", role: "Agent", status: "pending" as const, last: "—", listings: 0, hue: 280 },
  { name: "Marcus Reid", email: "marcus@recasi.com", role: "Developer", status: "active" as const, last: "14m ago", listings: 0, hue: 160 },
  { name: "Priya Shah", email: "priya@recasi.com", role: "Reviewer", status: "active" as const, last: "32m ago", listings: 0, hue: 120 },
  { name: "Tom Becker", email: "tom@pinnacle.com", role: "Agent", status: "invited" as const, last: "—", listings: 0, hue: 40 },
];
