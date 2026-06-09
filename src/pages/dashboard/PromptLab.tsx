import { useEffect, useRef, useState, useCallback, useMemo, type CSSProperties } from "react";
import { LabSubNav } from "@/components/dashboard/LabSubNav";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  Loader2,
  AlertTriangle,
  Upload,
  Star,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Play,
  Sparkles,
  DollarSign,
  Check,
  ChevronDown,
} from "lucide-react";
import { PageHeading, Card } from "@/components/dashboard/primitives";

// ─── Design-system input primitives ───────────────────────────────────────────
const INPUT_STYLE: CSSProperties = {
  padding: "9px 14px",
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
};
const TEXTAREA_STYLE: CSSProperties = {
  ...INPUT_STYLE,
  resize: "vertical",
  minHeight: 100,
  lineHeight: 1.5,
};
import {
  uploadLabImage,
  listSessions,
  createSession,
  getSession,
  deleteSession,
  updateSession,
  analyzeSession,
  refineIteration,
  renderIteration,
  rerenderWithProvider,
  rateIteration,
  overrideJudgeRating,
  fetchBatchSelection,
  type LabSession,
  type LabIteration,
  type JudgeRubricResult,
  type BatchSelectionResponse,
  type BatchSelectionItem,
} from "@/lib/promptLabApi";
import { HALLUCINATION_FLAGS, type HallucinationFlag } from "../../../lib/prompts/judge-rubric.js";
import { promoteRecipe } from "@/lib/recipesApi";
import { supabase } from "@/lib/supabase";
import { V1_ATLAS_SKUS, V1_DEFAULT_SKU, type V1AtlasSku } from "../../../lib/providers/router.js";
import { surfaceAffinityForPick } from "../../../lib/providers/sku-motion-affinity.js";
import { V1_1_LAB_SKUS, V1_1_DEFAULT_SKU, type V1_1LabSku, getLabModel, getSupportedResolutions } from "@/lib/labModels";
import { DirectorModal } from "@/components/lab/DirectorModal";
import { ModelFeedbackPanel } from "@/components/lab/ModelFeedbackPanel";

// Per-clip cost (5s render). Atlas SKUs match ATLAS_MODELS.priceCentsPerClip
// in lib/providers/atlas.ts. "kling-v2-native" and "runway-gen4-native" are
// synthetic dropdown entries that route via the native Kling/Runway providers
// (not Atlas). Runway is useful for exterior / drone / top_down shots where
// it was historically stronger than Kling.
// V1_1LabSku covers the v1.1 catalog (Seedance, Kling v3, etc.)
type SkuChoice = V1AtlasSku | "kling-v2-native" | "runway-gen4-native" | V1_1LabSku;

const V1_SKU_COST_CENTS: Record<SkuChoice, number> = {
  "kling-v2-6-pro": 60,     // $0.60 per 5s clip (Atlas)
  "kling-v2-master": 111,   // $1.11 per 5s clip (Atlas)
  "kling-v2-native": 0,     // pre-paid credits; cash cost 0¢
  "runway-gen4-native": 25, // ~25¢ per 5s clip (gen4_turbo, 5 credits/s × 1¢/credit)
};
const V1_SKU_LABELS: Record<SkuChoice, string> = {
  "kling-v2-6-pro": "v2.6 Pro (default)",
  "kling-v2-master": "v2 Master",
  "kling-v2-native": "v2 Native (Kling credits)",
  "runway-gen4-native": "Runway gen4_turbo (exteriors)",
};
const SKU_DROPDOWN_OPTIONS: readonly SkuChoice[] = [
  "kling-v2-6-pro",
  "kling-v2-master",
  "kling-v2-native",
  "runway-gen4-native",
] as const;

// v1.1 SKU cost + labels — pulled from LAB_MODELS catalog.
function v11SkuLabel(sku: V1_1LabSku): string {
  const info = getLabModel(sku);
  return info ? info.label : sku;
}
function v11SkuCostLabel(sku: V1_1LabSku): string {
  const info = getLabModel(sku);
  if (!info) return "";
  return info.priceCents === 0 ? "credits" : `≈ $${(info.priceCents / 100).toFixed(2)}`;
}

// True when the selected SKU routes via the native Kling provider (not Atlas).
// Caller submits { provider: "kling" } instead of { sku }.
function isNativeKlingSku(sku: SkuChoice): sku is "kling-v2-native" {
  return sku === "kling-v2-native";
}

// True when the selected SKU routes via the native Runway provider (not Atlas).
// Caller submits { provider: "runway" } instead of { sku }.
function isNativeRunwaySku(sku: SkuChoice): sku is "runway-gen4-native" {
  return sku === "runway-gen4-native";
}

// True when the SKU bypasses Atlas (native Kling or native Runway).
function isNativeProviderSku(sku: SkuChoice): boolean {
  return isNativeKlingSku(sku) || isNativeRunwaySku(sku);
}

const RATING_TAGS = [
  "clean motion",
  "cinematic",
  "perfect",
  "stayed in room",
  "hallucinated architecture",
  "wrong motion direction",
  "camera exited room",
  "warped geometry",
  "added people/objects",
  "too static",
  "too fast",
  "low quality",
];

// ─── Version segmented control ───

type PipelineVersion = 'v1' | 'v1.1';

function VersionToggle({ version, onChange }: { version: PipelineVersion; onChange: (v: PipelineVersion) => void }) {
  const options: Array<{ value: PipelineVersion; label: string }> = [
    { value: 'v1', label: 'v1 — Default' },
    { value: 'v1.1', label: 'v1.1 — Seedance' },
  ];
  return (
    <div className="le-seg" style={{ marginBottom: 0, alignSelf: 'flex-start' }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`le-seg-item${version === opt.value ? ' is-active' : ''}`}
          style={{ fontFamily: 'var(--le-font-sans)' }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Route helpers ───
// Returns a versioned path to the Prompt Lab, with or without a session id.
function versionedLabPath(id?: string, version: string = 'v1'): string {
  const base = id
    ? `/dashboard/development/prompt-lab/${id}`
    : '/dashboard/development/prompt-lab';
  return `${base}?v=${version}`;
}

const LAB_VERSION_KEY = 'lab.pipelineVersion';

function isValidVersion(v: string | null): v is PipelineVersion {
  return v === 'v1' || v === 'v1.1';
}

const PromptLab = () => {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawV = searchParams.get('v');

  // Fix 1: If no ?v= param, restore from localStorage (default v1.1).
  useEffect(() => {
    if (rawV !== null) return; // URL already has a version — honour it.
    const saved = localStorage.getItem(LAB_VERSION_KEY);
    const fallback: PipelineVersion = isValidVersion(saved) ? saved : 'v1.1';
    setSearchParams({ v: fallback }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const version: PipelineVersion = rawV === 'v1.1' ? 'v1.1' : (rawV === 'v1' ? 'v1' : 'v1.1');

  function handleVersionChange(v: PipelineVersion) {
    localStorage.setItem(LAB_VERSION_KEY, v);
    setSearchParams({ v }, { replace: true });
  }

  if (sessionId) return <SessionDetail sessionId={sessionId} version={version} onVersionChange={handleVersionChange} />;
  return <SessionList version={version} onVersionChange={handleVersionChange} />;
};

// ─── List view ───

function SessionList({ version, onVersionChange }: { version: PipelineVersion; onVersionChange: (v: PipelineVersion) => void }) {
  const [sessions, setSessions] = useState<LabSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchLabel, setBatchLabel] = useState("");
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const navigate = useNavigate();

  const [showArchived, setShowArchived] = useState(false);

  async function reload() {
    try {
      const r = await listSessions({ includeArchived: showArchived, pipelineVersion: version });
      setSessions(r.sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    reload();
  }, [showArchived, version]);

  useEffect(() => {
    reload();
  }, []);

  // Auto-refresh every 15s while any session has an active render or a
  // clip waiting to be rated. Only when the tab is visible.
  useEffect(() => {
    if (!sessions) return;
    const anyActive = sessions.some((s) => s.pending_render || s.ready_for_approval);
    if (!anyActive) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 15000);
    return () => clearInterval(timer);
  }, [sessions]);

  async function handleUpload(files: FileList) {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    setUploadProgress({ done: 0, total: files.length });
    const batch = batchLabel.trim() || null;
    const createdIds: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const { url, path } = await uploadLabImage(f);
        const session = await createSession({
          image_url: url,
          image_path: path,
          label: f.name.replace(/\.[^.]+$/, ""),
          batch_label: batch ?? undefined,
          pipelineVersion: version,
        });
        createdIds.push(session.id);
        setUploadProgress({ done: i + 1, total: files.length });
      }

      if (autoAnalyze) {
        // Kick off analyses in parallel, don't wait — user can watch progress in list.
        await Promise.allSettled(createdIds.map((id) => analyzeSession(id)));
      }

      // If the operator uploaded several photos with no batch label, offer to
      // group them. This is the common listing-drop flow — user drags 20
      // images and doesn't always remember to type a name first.
      if (!batch && files.length > 1 && createdIds.length > 1) {
        const makeBatch = window.confirm(
          `Group these ${createdIds.length} photos into a new batch?`,
        );
        if (makeBatch) {
          const suggested = `Batch · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
          const name = window.prompt("Name this batch:", suggested)?.trim();
          if (name) {
            await Promise.all(createdIds.map((id) => updateSession(id, { batch_label: name })));
          }
        }
      }

      await reload();

      // If only one uploaded, jump into its detail view.
      if (createdIds.length === 1) {
        navigate(versionedLabPath(createdIds[0], version));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Fix 2: VersionToggle lives in the sticky sub-nav row so it never scrolls off-screen. */}
      <LabSubNav rightSlot={<VersionToggle version={version} onChange={onVersionChange} />} />
      <PageHeading
        eyebrow="Lab"
        title="Prompt Lab"
        sub="Upload an image. Analyze, direct, refine, render."
      />

      <FileDropZone
        uploading={uploading}
        uploadProgress={uploadProgress}
        batchLabel={batchLabel}
        setBatchLabel={setBatchLabel}
        autoAnalyze={autoAnalyze}
        setAutoAnalyze={setAutoAnalyze}
        onFiles={handleUpload}
        error={error}
      />

      {sessions === null ? (
        <div style={{ padding: "64px 0", display: "flex", justifyContent: "center" }}>
          <Loader2 style={{ width: 22, height: 22 }} className="animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius)",
            padding: 48,
            textAlign: "center",
            fontSize: 13,
            color: "var(--muted)",
          }}
        >
          {version === 'v1.1'
            ? "No v1.1 sessions yet. Click ‘New session’ to create one — every iteration will route through Seedance 2.0 push-in with FFmpeg speed-ramp polish, separate from your v1 work."
            : "No sessions yet. Upload an image above to start."}
        </div>
      ) : (
        <BatchGroups sessions={sessions} onReload={reload} showArchived={showArchived} setShowArchived={setShowArchived} version={version} />
      )}
    </div>
  );
}

// ─── File dropzone with batch + auto-analyze controls ───

function FileDropZone({
  uploading,
  uploadProgress,
  batchLabel,
  setBatchLabel,
  autoAnalyze,
  setAutoAnalyze,
  onFiles,
  error,
}: {
  uploading: boolean;
  uploadProgress: { done: number; total: number } | null;
  batchLabel: string;
  setBatchLabel: (s: string) => void;
  autoAnalyze: boolean;
  setAutoAnalyze: (b: boolean) => void;
  onFiles: (files: FileList) => void;
  error: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <Card
      padding={14}
      style={{ border: dragOver ? "1px solid var(--ink)" : undefined, background: dragOver ? "rgba(11,11,16,0.02)" : undefined }}
    >
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (e.dataTransfer.files?.length) {
            e.preventDefault();
            setDragOver(false);
            onFiles(e.dataTransfer.files);
          }
        }}
        style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}
      >
        <input
          value={batchLabel}
          onChange={(e) => setBatchLabel(e.target.value)}
          placeholder="Batch label (optional)"
          style={{
            flex: 1,
            minWidth: 180,
            padding: "7px 10px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--line)",
            background: "var(--surface)",
            fontSize: 12.5,
            fontFamily: "var(--le-font-sans)",
            color: "var(--ink)",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)", cursor: "pointer", userSelect: "none" as const }}>
          <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} disabled={uploading} style={{ accentColor: "var(--accent)", cursor: "pointer" }} />
          Auto-analyze
        </label>
        <label
          className="le-btn-ghost"
          style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}
          title="Drag files anywhere on this row, or click to choose"
        >
          {uploading ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> : <Upload style={{ width: 14, height: 14 }} />}
          <span>
            {uploading
              ? uploadProgress
                ? `${uploadProgress.done}/${uploadProgress.total}…`
                : "Uploading…"
              : "Upload images"}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) onFiles(e.target.files);
            }}
            disabled={uploading}
          />
        </label>
        {error && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--bad)" }}>
            <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0 }} />
            {error}
          </span>
        )}
      </div>
    </Card>
  );
}

// ─── Batch groups with drag-drop + rename ───

type ShotStatus = "not_started" | "in_progress" | "completed";

function statusOf(s: LabSession): ShotStatus {
  if (s.completed) return "completed";
  // "Need to start" = admin hasn't given any feedback yet (no ratings,
  // tags, comments, or refinements). An auto-analyzed session without any
  // human input still counts as "need to start."
  if (!s.has_feedback) return "not_started";
  return "in_progress";
}

function BatchGroups({ sessions, onReload, showArchived, setShowArchived, version }: { sessions: LabSession[]; onReload: () => void; showArchived: boolean; setShowArchived: (v: boolean) => void; version: PipelineVersion }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, "all" | ShotStatus>>({});
  const [organizeMode, setOrganizeMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Batches start collapsed — show as compact widgets, expand on click. Users
  // asked for this after every session in every batch rendering up-front was
  // making the Prompt Lab landing page slow and visually busy.
  // Single-batch expansion (was a Set; multi-expand caused the grid to reflow
  // chaotically). Now one batch at a time pops UP to a drawer above the grid.
  const [expandedBatchKey, setExpandedBatchKey] = useState<string | null>(null);
  // Director modal state — set to the batch key whose Direct button was clicked.
  const [directorBatchKey, setDirectorBatchKey] = useState<string | null>(null);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllInBatch(batch: string, items: LabSession[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = items.every((s) => next.has(s.id));
      for (const s of items) {
        if (allSelected) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  }

  function toggleExpand(batch: string) {
    setExpandedBatchKey((prev) => (prev === batch ? null : batch));
  }

  async function batchMoveSelected(targetLabel: string | null) {
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => updateSession(id, { batch_label: targetLabel })),
      );
      setSelectedIds(new Set());
      onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function groupSelected() {
    const name = prompt("Name this batch");
    if (!name?.trim()) return;
    await batchMoveSelected(name.trim());
  }

  async function archiveSelected() {
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => updateSession(id, { archived: true })),
      );
      setSelectedIds(new Set());
      onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function unarchiveSelected() {
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => updateSession(id, { archived: false })),
      );
      setSelectedIds(new Set());
      onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const ordered = useMemo(() => {
    const groups = new Map<string, LabSession[]>();
    for (const s of sessions) {
      const key = s.batch_label?.trim() || "Unbatched";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === "Unbatched") return -1;
      if (b[0] === "Unbatched") return 1;
      const aNewest = Math.max(...a[1].map((s) => new Date(s.created_at).getTime()));
      const bNewest = Math.max(...b[1].map((s) => new Date(s.created_at).getTime()));
      return bNewest - aNewest;
    });
  }, [sessions]);

  async function moveSession(sessionId: string, newLabel: string | null) {
    try {
      await updateSession(sessionId, { batch_label: newLabel });
      onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function renameBatch(oldLabel: string, newLabel: string) {
    const target = newLabel.trim() || null;
    if (oldLabel === "Unbatched" && !target) return;
    try {
      const affected = sessions.filter((s) => (s.batch_label?.trim() || "Unbatched") === oldLabel);
      await Promise.all(affected.map((s) => updateSession(s.id, { batch_label: target })));
      onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function createBatchFromDrop(sessionId: string) {
    const name = prompt("Name this new batch");
    if (!name?.trim()) return;
    await moveSession(sessionId, name.trim());
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Organize toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className={organizeMode ? "le-btn-dark" : "le-btn-ghost"}
          onClick={() => {
            setOrganizeMode((prev) => !prev);
            if (organizeMode) setSelectedIds(new Set());
          }}
        >
          {organizeMode ? "Done organizing" : "Organize"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {organizeMode && selectedIds.size > 0 && (
            <>
              <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{selectedIds.size} selected</span>
              <button type="button" className="le-btn-ghost" onClick={groupSelected}>
                Group into batch
              </button>
              {ordered.filter(([b]) => b !== "Unbatched").length > 0 && (
                <select
                  style={{
                    padding: "6px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--line)",
                    background: "var(--surface)",
                    fontSize: 12,
                    fontFamily: "var(--le-font-sans)",
                    color: "var(--ink-2)",
                    cursor: "pointer",
                  }}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) batchMoveSelected(e.target.value === "__unbatched__" ? null : e.target.value);
                  }}
                >
                  <option value="" disabled>Move to...</option>
                  <option value="__unbatched__">Unbatched</option>
                  {ordered.filter(([b]) => b !== "Unbatched").map(([b]) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              )}
              {Array.from(selectedIds).some((id) => !sessions.find((s) => s.id === id)?.archived) && (
                <button type="button" className="le-btn-ghost" onClick={archiveSelected}>
                  <Trash2 style={{ width: 12, height: 12, marginRight: 4 }} />
                  Archive
                </button>
              )}
              {showArchived && Array.from(selectedIds).some((id) => sessions.find((s) => s.id === id)?.archived) && (
                <button type="button" className="le-btn-ghost" onClick={unarchiveSelected}>
                  Unarchive
                </button>
              )}
              <button type="button" className="le-btn-ghost" onClick={() => setSelectedIds(new Set())}>
                Clear
              </button>
            </>
          )}
          <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--ink-2)", cursor: "pointer", userSelect: "none" as const }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              style={{ accentColor: "var(--accent)", cursor: "pointer" }}
            />
            Show archived
          </label>
        </div>
      </div>

      {/* Expanded batch — rendered as a full-width DRAWER above the batches
          grid (rather than reflowing one grid cell into a giant block). */}
      {(() => {
        const expandedEntry = expandedBatchKey
          ? ordered.find(([b]) => b === expandedBatchKey)
          : undefined;
        if (!expandedEntry) return null;
        const [batch, items] = expandedEntry;
        const rated = items.filter((i) => typeof i.best_rating === "number");
        const avgRating = rated.length > 0 ? rated.reduce((s, i) => s + (i.best_rating ?? 0), 0) / rated.length : null;
        const counts = {
          all: items.length,
          not_started: items.filter((i) => statusOf(i) === "not_started").length,
          in_progress: items.filter((i) => statusOf(i) === "in_progress").length,
          completed: items.filter((i) => statusOf(i) === "completed").length,
        };
        const filter = filters[batch] ?? "all";
        const filtered = filter === "all" ? items : items.filter((i) => statusOf(i) === filter);
        const visible = [...filtered].sort((a, b) => {
          const priority = (s: LabSession) => {
            if (!s.completed && !s.pending_render && s.ready_for_approval) return 0;
            if (!s.completed && !s.pending_render && !s.ready_for_approval && s.iteration_needs_attention) return 1;
            if (s.pending_render) return 2;
            if (s.completed) return 4;
            return 3;
          };
          return priority(a) - priority(b);
        });
        const directBatchEnabled = items.some((s) => !!s.completed) || items.some((s) => statusOf(s) === "in_progress");
        return (
          <div className="le-card" style={{ padding: 20 }}>
            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={() => toggleExpand(batch)}
                  type="button"
                  className="le-btn-ghost"
                  title="Collapse"
                  style={{ padding: "4px 8px" }}
                >
                  <ChevronDown style={{ width: 14, height: 14 }} />
                </button>
                <BatchTitle label={batch} onRename={(v) => renameBatch(batch, v)} />
                {organizeMode && (
                  <button
                    type="button"
                    onClick={() => selectAllInBatch(batch, items)}
                    style={{ marginLeft: 8, fontSize: 10, color: "var(--muted)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {items.every((s) => selectedIds.has(s.id)) ? "Deselect all" : "Select all"}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                  {counts.completed}/{counts.all} completed
                  {avgRating ? ` · avg ${avgRating.toFixed(1)}★` : ""}
                </span>
                <button
                  type="button"
                  className="le-btn-ghost"
                  onClick={() => setDirectorBatchKey(batch)}
                  disabled={!directBatchEnabled}
                  title={directBatchEnabled ? "Open the Director and assemble a video from this batch's rendered clips" : "No rendered clips in this batch yet"}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, opacity: directBatchEnabled ? 1 : 0.45 }}
                >
                  🎬 Direct batch
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 6 }}>
              <div className="le-seg">
                {(
                  [
                    ["all", `All (${counts.all})`],
                    ["not_started", `Need to start (${counts.not_started})`],
                    ["in_progress", `In progress (${counts.in_progress})`],
                    ["completed", `Completed (${counts.completed})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilters((prev) => ({ ...prev, [batch]: key }))}
                    className={`le-seg-item${filter === key ? " is-active" : ""}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <ListingSelectionSection batchLabel={batch === "Unbatched" ? null : batch} version={version} />

            {visible.length === 0 ? (
              <div style={{ border: "1px dashed var(--line)", borderRadius: "var(--radius)", padding: 24, textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                No sessions in this filter.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16 }}>
                {visible.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    version={version}
                    isDragging={draggingId === s.id}
                    organizeMode={organizeMode}
                    selected={selectedIds.has(s.id)}
                    onToggleSelect={() => toggleSelect(s.id)}
                    onDragStart={() => setDraggingId(s.id)}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropTarget(null);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Collapsed batch tiles — clean grid, no inline expansion */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
        {ordered.map(([batch, items]) => {
          // Skip the currently-expanded batch — it's rendered in the drawer above.
          if (batch === expandedBatchKey) return null;

          const rated = items.filter((i) => typeof i.best_rating === "number");
          const avgRating = rated.length > 0 ? rated.reduce((s, i) => s + (i.best_rating ?? 0), 0) / rated.length : null;
          const isTarget = dropTarget === batch;

          const counts = {
            all: items.length,
            completed: items.filter((i) => statusOf(i) === "completed").length,
          };

          // Pick up to four preview images (by newest created_at) for the collapsed tile's 2×2 grid.
          const previewImages = [...items]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 4)
            .map((s) => s.image_url ?? null);

          return (
            <div
              key={batch}
              style={isTarget ? { outline: "2px solid var(--ink)", borderRadius: "var(--radius)", background: "rgba(11,11,16,0.03)" } : undefined}
              onDragOver={(e) => {
                if (draggingId) {
                  e.preventDefault();
                  setDropTarget(batch);
                }
              }}
              onDragLeave={() => setDropTarget((prev) => (prev === batch ? null : prev))}
              onDrop={(e) => {
                if (draggingId) {
                  e.preventDefault();
                  const newLabel = batch === "Unbatched" ? null : batch;
                  moveSession(draggingId, newLabel);
                  setDraggingId(null);
                  setDropTarget(null);
                }
              }}
            >
              <button
                type="button"
                onClick={() => toggleExpand(batch)}
                className="le-lift"
                title={`Expand "${batch}"`}
                style={{ display: "flex", flexDirection: "column", width: "100%", padding: 12, textAlign: "left", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", cursor: "pointer", aspectRatio: "1" }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 3, flex: 1, minHeight: 0, marginBottom: 10, overflow: "hidden", borderRadius: 10 }}>
                  {previewImages.map((src, i) => (
                    <div key={i} style={{ overflow: "hidden", background: "rgba(11,11,16,0.06)" }}>
                      {src ? (
                        <img src={src} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      ) : null}
                    </div>
                  ))}
                  {Array.from({ length: Math.max(0, 4 - previewImages.length) }).map((_, i) => (
                    <div key={`placeholder-${i}`} style={{ background: "var(--line-2)" }} />
                  ))}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{batch}</div>
                  <div style={{ marginTop: 3, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                    {counts.all} session{counts.all === 1 ? "" : "s"} · {counts.completed}/{counts.all} done
                    {avgRating ? ` · ${avgRating.toFixed(1)}★` : ""}
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {/* Drop-here-to-create-new-batch zone */}
      <div
        style={{
          borderRadius: "var(--radius)",
          border: `2px dashed ${draggingId ? "var(--ink)" : "var(--line)"}`,
          padding: 24,
          textAlign: "center",
          fontSize: 12,
          color: draggingId ? "var(--ink)" : "var(--muted)",
          background: draggingId ? "rgba(11,11,16,0.02)" : undefined,
          transition: "all 0.15s",
        }}
        onDragOver={(e) => {
          if (draggingId) e.preventDefault();
        }}
        onDrop={(e) => {
          if (draggingId) {
            e.preventDefault();
            const id = draggingId;
            setDraggingId(null);
            createBatchFromDrop(id);
          }
        }}
      >
        Drop a session here to create a new batch
      </div>

      {/* Director modal for batch-level assemblies */}
      {directorBatchKey && (() => {
        const entry = ordered.find(([b]) => b === directorBatchKey);
        if (!entry) return null;
        const [batch, items] = entry;
        const sessionIds = items.map((s) => s.id);
        return (
          <DirectorModal
            source={{ kind: "batch", batchLabel: batch, sessionIds }}
            open={true}
            onClose={() => setDirectorBatchKey(null)}
          />
        );
      })()}
    </div>
  );
}

// Inline "see listing selection" panel — replays the production selectPhotos
// algorithm on every session in a batch so the operator can see which photos
// would land in a real listing video and which would be skipped (and why),
// without having to actually ship the batch through the pipeline.
function ListingSelectionSection({ batchLabel, version }: { batchLabel: string | null; version: PipelineVersion }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BatchSelectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchBatchSelection(batchLabel);
      setData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    if (!open) {
      setOpen(true);
      if (!data && !loading) await run();
    } else {
      setOpen(false);
    }
  }

  return (
    <div style={{ marginBottom: 16, border: "1px solid var(--line)", borderRadius: "var(--radius-sm)" }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          textAlign: "left",
          fontSize: 12,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink)" }}>
          <Sparkles style={{ width: 13, height: 13, color: "var(--accent)" }} />
          <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 11 }}>See listing selection</span>
          {data && (
            <span style={{ color: "var(--muted)" }}>
              · {data.selected_count} picked · {data.not_selected_count} skipped · {data.discarded_count} discarded
              {data.unanalyzed.length > 0 ? ` · ${data.unanalyzed.length} unanalyzed` : ""}
            </span>
          )}
        </span>
        <ChevronDown style={{ width: 14, height: 14, color: "var(--muted)", transform: open ? undefined : "rotate(-90deg)", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--line-2)", padding: "14px 14px 10px" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "24px 0", color: "var(--muted)", fontSize: 12 }}>
              <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> Running production selection…
            </div>
          ) : error ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 0", color: "var(--bad)", fontSize: 12 }}>
              <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
              <button type="button" onClick={run} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 12, textDecoration: "underline", color: "var(--muted)", fontFamily: "inherit" }}>Retry</button>
            </div>
          ) : !data ? (
            <div style={{ padding: "12px 0", color: "var(--muted)", fontSize: 12 }}>Loading…</div>
          ) : (
            <>
              <p style={{ marginBottom: 14, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
                Target {data.target} scenes · max {data.max_per_room} per room type. Run against each session's cached vision analysis.
                {data.unanalyzed.length > 0 && (
                  <> {data.unanalyzed.length} session{data.unanalyzed.length === 1 ? "" : "s"} still need analysis and were excluded.</>
                )}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                <SelectionColumn
                  title="Selected"
                  count={data.selected_count}
                  items={data.items.filter((i) => i.status === "selected")}
                  tone="positive"
                  onOpenSession={(id) => navigate(versionedLabPath(id, version))}
                />
                <SelectionColumn
                  title="Not selected"
                  count={data.not_selected_count}
                  items={data.items.filter((i) => i.status === "not_selected")}
                  tone="neutral"
                  onOpenSession={(id) => navigate(versionedLabPath(id, version))}
                />
                <SelectionColumn
                  title="Discarded"
                  count={data.discarded_count}
                  items={data.items.filter((i) => i.status === "discarded")}
                  tone="negative"
                  onOpenSession={(id) => navigate(versionedLabPath(id, version))}
                />
              </div>
              {data.unanalyzed.length > 0 && (
                <div style={{ marginTop: 16, borderTop: "1px solid var(--line-2)", paddingTop: 12, color: "var(--muted)" }}>
                  <div style={{ marginBottom: 8, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em" }}>
                    Unanalyzed ({data.unanalyzed.length})
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {data.unanalyzed.map((u) => (
                      <button
                        key={u.session_id}
                        type="button"
                        onClick={() => navigate(versionedLabPath(u.session_id, version))}
                        style={{ width: 40, height: 40, overflow: "hidden", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", cursor: "pointer", padding: 0 }}
                        title={u.label ?? ""}
                      >
                        {u.image_url && (
                          <img src={u.image_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="le-btn-ghost" onClick={run} style={{ fontSize: 11.5 }}>
                  {loading && <Loader2 style={{ width: 12, height: 12, marginRight: 4 }} className="animate-spin" />}
                  Re-run
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SelectionColumn({
  title,
  count,
  items,
  tone,
  onOpenSession,
}: {
  title: string;
  count: number;
  items: BatchSelectionItem[];
  tone: "positive" | "neutral" | "negative";
  onOpenSession: (sessionId: string) => void;
}) {
  const headerColor =
    tone === "positive" ? "var(--good)"
    : tone === "negative" ? "var(--bad)"
    : "var(--muted)";

  return (
    <div>
      <div style={{ marginBottom: 8, borderBottom: `1px solid var(--line)`, paddingBottom: 6, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.14em", color: headerColor }}>
        {title} ({count})
      </div>
      {items.length === 0 ? (
        <div style={{ padding: "12px 0", color: "var(--muted-2)", fontSize: 12 }}>—</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((i) => (
            <button
              key={i.session_id}
              type="button"
              onClick={() => onOpenSession(i.session_id)}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "flex-start",
                gap: 10,
                border: "1px solid var(--line-2)",
                borderRadius: "var(--radius-sm)",
                background: "var(--surface)",
                padding: 8,
                textAlign: "left",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(11,11,16,0.02)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface)"; }}
            >
              <div style={{ width: 56, height: 56, flexShrink: 0, overflow: "hidden", borderRadius: 8, background: "rgba(11,11,16,0.06)" }}>
                {i.image_url && (
                  <img src={i.image_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {i.rank != null && (
                    <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>#{i.rank}</span>
                  )}
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {i.room_type ? i.room_type.replace(/_/g, " ") : "?"}
                  </span>
                  {i.aesthetic_score != null && (
                    <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                      {i.aesthetic_score.toFixed(1)}/10
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 3, fontSize: 10, lineHeight: 1.4, color: "var(--muted)" }}>{i.reason}</div>
                {i.label && (
                  <div style={{ marginTop: 2, fontSize: 10, color: "var(--muted-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.label}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline "this SKU is a bad/good fit for this motion" hint. Reads the
// hand-curated + data-backed affinity table; renders nothing when there's no
// opinion for the motion, so untested motions stay silent instead of showing
// a noisy "neutral" badge.
function SkuAffinityHint({
  cameraMovement,
  sku,
  onPickSuggested,
}: {
  cameraMovement: string | null | undefined;
  sku: string | null | undefined;
  onPickSuggested: (sku: string) => void;
}) {
  const hint = surfaceAffinityForPick({ cameraMovement, sku });
  if (!hint) return null;
  if (hint.verdict === "neutral") return null;

  const isAvoid = hint.verdict === "avoid";
  const dotColor = isAvoid ? "var(--warn)" : "var(--good)";
  const textColor = isAvoid ? "var(--warn)" : "var(--good)";

  return (
    <div className="le-card-flat" style={{ padding: 10, display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 8, fontSize: 12.5 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: textColor }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0, display: "inline-block" }} />
        {isAvoid ? "bad fit" : "best fit"}
      </span>
      <span style={{ flex: 1, lineHeight: 1.45, color: "var(--ink-2)" }}>{hint.message}</span>
      {isAvoid && hint.suggested_sku && (
        <button
          type="button"
          className="le-btn-ghost"
          onClick={() => onPickSuggested(hint.suggested_sku!)}
          title={hint.evidence}
          style={{ fontSize: 10.5, padding: "3px 8px" }}
        >
          Use {hint.suggested_sku}
        </button>
      )}
    </div>
  );
}

function BatchTitle({ label, onRename }: { label: string; onRename: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label === "Unbatched" ? "" : label);

  useEffect(() => {
    setDraft(label === "Unbatched" ? "" : label);
  }, [label]);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== (label === "Unbatched" ? "" : label)) onRename(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(label === "Unbatched" ? "" : label);
            setEditing(false);
          }
        }}
        placeholder={label === "Unbatched" ? "Name this batch…" : ""}
        style={{
          background: "transparent",
          border: "none",
          borderBottom: "1px solid var(--line)",
          outline: "none",
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: "var(--ink)",
          fontFamily: "inherit",
          minWidth: 0,
        }}
      />
    );
  }
  return (
    <h3
      onClick={() => setEditing(true)}
      style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink)", cursor: "text" }}
      title="Click to rename (renames all sessions in this batch)"
    >
      {label}
    </h3>
  );
}

function SessionCard({
  session,
  version,
  isDragging,
  organizeMode,
  selected,
  onToggleSelect,
  onDragStart,
  onDragEnd,
}: {
  session: LabSession;
  version: PipelineVersion;
  isDragging: boolean;
  organizeMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const borderColor = organizeMode
    ? selected ? "var(--ink)" : "var(--line)"
    : session.completed ? "rgba(47,138,85,0.3)" : "var(--line)";

  return (
    <Link
      to={organizeMode ? "#" : versionedLabPath(session.id, version)}
      onClick={organizeMode ? (e) => { e.preventDefault(); onToggleSelect(); } : undefined}
      draggable={!organizeMode}
      onDragStart={organizeMode ? undefined : (e) => {
        e.dataTransfer.setData("text/session-id", session.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={organizeMode ? undefined : onDragEnd}
      className="le-lift"
      style={{
        display: "block",
        textDecoration: "none",
        border: `1px solid ${borderColor}`,
        borderRadius: "var(--radius)",
        background: "var(--surface)",
        overflow: "hidden",
        opacity: isDragging ? 0.4 : 1,
        cursor: organizeMode ? "pointer" : undefined,
        boxShadow: organizeMode && selected ? `0 0 0 2px rgba(11,11,16,0.15)` : undefined,
      }}
    >
      <div style={{ position: "relative", aspectRatio: "16/9", width: "100%", overflow: "hidden", background: "rgba(11,11,16,0.06)" }}>
        {organizeMode && (
          <div style={{ position: "absolute", top: 8, left: 8, zIndex: 10 }}>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: selected ? "2px solid var(--ink)" : "2px solid rgba(255,255,255,0.8)",
                background: selected ? "var(--ink)" : "rgba(0,0,0,0.3)",
                color: selected ? "var(--surface)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {selected && <Check style={{ width: 10, height: 10 }} />}
            </div>
          </div>
        )}
        <img src={session.image_url} alt={session.label ?? "session"} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none", display: "block" }} />
        {session.pending_render && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, background: "rgba(182,128,44,0.9)", padding: "5px 10px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "#fff" }}>
              <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
              Rendering
            </div>
          </div>
        )}
        {session.archived && (
          <div style={{ position: "absolute", top: 8, right: 8, display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 6, background: "rgba(100,100,110,0.85)", padding: "3px 8px", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "#fff" }}>
            Archived
          </div>
        )}
        {!session.archived && session.completed && (
          <div style={{ position: "absolute", top: 8, right: 8, display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 6, background: "rgba(47,138,85,0.85)", padding: "3px 8px", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "#fff" }}>
            Completed
          </div>
        )}
        {!session.completed && !session.pending_render && session.ready_for_approval && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(42,111,219,0.9)", padding: "4px 8px", textAlign: "center", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "#fff" }}>
            Generation approval needed
          </div>
        )}
        {!session.completed && !session.pending_render && !session.ready_for_approval && session.iteration_needs_attention && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(30,130,118,0.9)", padding: "4px 8px", textAlign: "center", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "#fff" }}>
            Iteration approval needed
          </div>
        )}
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>{session.label || session.archetype || "Untitled"}</div>
        <div style={{ marginTop: 4, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
          <span>{session.iteration_count ?? 0} iter{session.iteration_count === 1 ? "" : "s"}</span>
          {typeof session.best_rating === "number" && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Star style={{ width: 11, height: 11, fill: "var(--ink)", color: "var(--ink)" }} />
              {session.best_rating}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Detail view ───

function SessionDetail({ sessionId, version, onVersionChange }: { sessionId: string; version: PipelineVersion; onVersionChange: (v: PipelineVersion) => void }) {
  const navigate = useNavigate();
  const [data, setData] = useState<{ session: LabSession; iterations: LabIteration[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [siblings, setSiblings] = useState<LabSession[]>([]);
  const [directorOpen, setDirectorOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const d = await getSession(sessionId);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Pull every session in the same batch (or the Unbatched pool) so the
  // operator can flip through them with the left/right arrow keys without
  // going back to the list. Fetched once per navigation; uses the cheap
  // sessions-list endpoint the landing page already hits.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      try {
        const { sessions: all } = await listSessions();
        if (cancelled) return;
        const currentKey = (data.session.batch_label ?? "").trim() || null;
        const batchSiblings = all
          .filter((s) => {
            const k = (s.batch_label ?? "").trim() || null;
            return k === currentKey && !s.archived;
          })
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        setSiblings(batchSiblings);
      } catch {
        // Sibling lookup is best-effort — it only powers keyboard nav. Silent fail.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  const siblingIndex = siblings.findIndex((s) => s.id === sessionId);
  const prevSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
  const nextSibling = siblingIndex >= 0 && siblingIndex < siblings.length - 1 ? siblings[siblingIndex + 1] : null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't hijack typing / modifier combos.
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const editable = tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (editable) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === "ArrowLeft" && prevSibling) {
        e.preventDefault();
        navigate(versionedLabPath(prevSibling.id, version));
      } else if (e.key === "ArrowRight" && nextSibling) {
        e.preventDefault();
        navigate(versionedLabPath(nextSibling.id, version));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevSibling, nextSibling, navigate]);

  // Auto-refresh every 10s while any iteration has an in-flight render OR a
  // pending judge (clip finalized but Gemini judge hasn't run yet — the
  // poll-judge cron drains at ~5/min so judgments land within ~1-2 minutes).
  useEffect(() => {
    if (!data) return;
    const anyRendering = data.iterations.some(
      (it) => it.provider_task_id && !it.clip_url && !it.render_error,
    );
    const anyJudgePending = data.iterations.some(
      (it) => it.clip_url && it.judge_rating_overall == null && it.judge_error == null,
    );
    if (!anyRendering && !anyJudgePending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 10000);
    return () => clearInterval(timer);
  }, [data, reload]);

  async function handleAnalyze() {
    setBusy("analyze");
    setError(null);
    try {
      await analyzeSession(sessionId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this session and all iterations?")) return;
    await deleteSession(sessionId);
    // Fix 3(b): back to list preserving version from the session itself.
    const deletedSessionVersion: PipelineVersion = data?.session.pipeline_version ?? version;
    navigate(versionedLabPath(undefined, deletedSessionVersion));
  }

  async function handleRender(iterationId: string, provider?: "kling" | "runway" | null, sku?: SkuChoice | null, resolution?: string) {
    setBusy(`render-${iterationId}`);
    setError(null);
    try {
      // Native pseudo-SKUs (kling-v2-native, runway-gen4-native): IterationCard
      // already set provider="kling"/"runway" before calling onRender. Drop the
      // sku param so the server uses the providerOverride path (not an Atlas SKU).
      const sendSku: V1AtlasSku | null = sku && !isNativeProviderSku(sku) ? (sku as V1AtlasSku) : null;
      const result = await renderIteration(iterationId, provider ?? null, sendSku, resolution ?? null);
      if (result.renderError) setError(`Render failed: ${result.renderError}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleRefine(iterationId: string, payload: {
    rating: number | null;
    tags: string[];
    comment: string;
    chatInstruction: string;
  }) {
    setBusy(`refine-${iterationId}`);
    setError(null);
    try {
      await refineIteration({
        iteration_id: iterationId,
        rating: payload.rating,
        tags: payload.tags.length ? payload.tags : null,
        comment: payload.comment || null,
        chat_instruction: payload.chatInstruction,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleRate(iterationId: string, payload: {
    rating: number | null;
    tags: string[];
    comment: string;
  }) {
    setBusy(`rate-${iterationId}`);
    setError(null);
    try {
      const result = await rateIteration({
        iteration_id: iterationId,
        rating: payload.rating,
        tags: payload.tags.length ? payload.tags : null,
        comment: payload.comment || null,
      });
      if (result.auto_promoted) {
        const tier = result.auto_promoted.tier === "backup" ? " (backup recipe)" : "";
        setSuccess(`Promoted to recipe "${result.auto_promoted.archetype}"${tier}`);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleRerender(
    sourceIterationId: string,
    provider: "kling" | "runway" | "atlas",
    sku?: SkuChoice | null,
    resolution?: string | null,
  ) {
    setBusy(`rerender-${sourceIterationId}`);
    setError(null);
    setSuccess(null);
    // If user picked a native-provider pseudo-SKU (kling-v2-native or
    // runway-gen4-native), route via provider="kling"/"runway" and drop the
    // sku param (Atlas SKUs are ignored on the native path).
    const effectiveProvider = sku && isNativeKlingSku(sku)
      ? "kling"
      : sku && isNativeRunwaySku(sku)
        ? "runway"
        : provider;
    const effectiveSku: V1AtlasSku | null = sku && !isNativeProviderSku(sku) ? (sku as V1AtlasSku) : null;
    try {
      const result = await rerenderWithProvider(sourceIterationId, effectiveProvider, effectiveSku, resolution ?? null);
      if (result.queued) {
        setSuccess(result.message ?? `Queued for ${effectiveProvider}`);
      } else {
        const label = sku ? ` (${V1_SKU_LABELS[sku]})` : "";
        const resLabel = resolution ? ` @ ${resolution}` : "";
        setSuccess(`Re-rendering with ${effectiveProvider}${label}${resLabel} — new iteration created`);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <div style={{ padding: "80px 0", textAlign: "center" }}>
        <Loader2 className="animate-spin" style={{ width: 22, height: 22, display: "block", margin: "0 auto", color: "var(--muted)" }} />
      </div>
    );
  }

  const { session, iterations } = data;
  const latest = iterations[iterations.length - 1];
  const totalCost = iterations.reduce((sum, it) => sum + (it.cost_cents ?? 0), 0);

  // Derive version from the session itself (source of truth), falling back to
  // the URL param. The session is locked at create time so these should agree.
  const sessionVersion: PipelineVersion = session.pipeline_version ?? version;
  const isV11 = sessionVersion === 'v1.1';

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Fix 2: VersionToggle in the sticky sub-nav row so it's always visible. */}
      <LabSubNav rightSlot={<VersionToggle version={sessionVersion} onChange={onVersionChange} />} />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link to={versionedLabPath(undefined, sessionVersion)} title="Back to list" style={{ color: "var(--muted)", display: "inline-flex" }}>
            <ArrowLeft style={{ width: 16, height: 16 }} />
          </Link>
          {siblings.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, borderLeft: "1px solid var(--line)", paddingLeft: 12 }}>
              <button
                type="button"
                onClick={() => prevSibling && navigate(versionedLabPath(prevSibling.id, sessionVersion))}
                disabled={!prevSibling}
                title={prevSibling ? `Previous (←) · ${prevSibling.label ?? "Untitled"}` : "No previous session"}
                style={{ background: "none", border: "none", cursor: prevSibling ? "pointer" : "default", color: "var(--muted)", opacity: !prevSibling ? 0.3 : 1, padding: 4 }}
              >
                <ArrowLeft style={{ width: 14, height: 14 }} />
              </button>
              <span style={{ padding: "0 4px", fontFamily: "var(--le-font-mono)", fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                {siblingIndex >= 0 ? siblingIndex + 1 : "?"}/{siblings.length}
              </span>
              <button
                type="button"
                onClick={() => nextSibling && navigate(versionedLabPath(nextSibling.id, sessionVersion))}
                disabled={!nextSibling}
                title={nextSibling ? `Next (→) · ${nextSibling.label ?? "Untitled"}` : "No next session"}
                style={{ background: "none", border: "none", cursor: nextSibling ? "pointer" : "default", color: "var(--muted)", opacity: !nextSibling ? 0.3 : 1, padding: 4 }}
              >
                <ArrowRight style={{ width: 14, height: 14 }} />
              </button>
            </div>
          )}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="le-d-label">Lab · Session</span>
              {/* Version badge — read-only. Switch version via SessionList. */}
              <span
                style={{
                  borderRadius: 6,
                  background: isV11 ? 'rgba(115,80,195,0.10)' : 'rgba(11,11,16,0.06)',
                  padding: '2px 8px',
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: isV11 ? 'var(--accent)' : 'var(--muted)',
                  fontFamily: 'var(--le-font-sans)',
                  userSelect: 'none',
                }}
                title={isV11 ? 'v1.1 — Seedance push-in. To switch versions, go back to the session list.' : 'v1 — Default mixed-movement routing.'}
              >
                {isV11 ? 'v1.1 — Seedance push-in' : 'v1 — Default'}
              </span>
            </div>
            <EditableLabel
              value={session.label}
              placeholder="Untitled session"
              onSave={async (v) => {
                await updateSession(sessionId, { label: v });
                reload();
              }}
            />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "var(--muted)" }}>
          {/* Director button — v1.1 sessions only */}
          {isV11 && (
            <button
              type="button"
              onClick={() => setDirectorOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--surface)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--accent)",
                fontFamily: "var(--le-font-sans)",
                transition: "border-color 0.12s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--line)"; }}
            >
              🎬 Direct
            </button>
          )}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontVariantNumeric: "tabular-nums" }}>
            <DollarSign style={{ width: 12, height: 12 }} />
            ${(totalCost / 100).toFixed(3)}
          </span>
          {iterations.length > 0 && (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              avg ${(iterations.reduce((s, i) => s + (i.cost_cents ?? 0), 0) / iterations.length / 100).toFixed(2)}/clip
            </span>
          )}
          <button
            type="button"
            onClick={handleDelete}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--muted)", fontFamily: "var(--le-font-sans)" }}
          >
            <Trash2 style={{ width: 13, height: 13 }} />
            Delete
          </button>
        </div>
      </div>

      {/* Director modal — v1.1 only */}
      {isV11 && (
        <DirectorModal
          source={{ kind: "session", sessionId: sessionId, iterations: iterations }}
          open={directorOpen}
          onClose={() => setDirectorOpen(false)}
        />
      )}

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(196,74,74,0.3)",
            background: "rgba(196,74,74,0.05)",
            fontSize: 13,
            color: "var(--bad)",
          }}
        >
          <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(47,138,85,0.3)",
            background: "rgba(47,138,85,0.05)",
            fontSize: 13,
            color: "var(--good)",
          }}
        >
          <Sparkles style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1 }} />
          <span>{success}</span>
          <button
            type="button"
            onClick={() => setSuccess(null)}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--muted)", fontFamily: "var(--le-font-sans)" }}
          >
            dismiss
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 32, alignItems: "flex-start" }}>
        {/* Source image column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 16, alignSelf: "start" }}>
          <Card padding={0} style={{ overflow: "hidden" }}>
            <img src={session.image_url} alt="source" style={{ width: "100%", display: "block" }} />
          </Card>
          {iterations.length === 0 && (
            <button type="button" className="le-btn-dark" onClick={handleAnalyze} disabled={busy === "analyze"} style={{ width: "100%", justifyContent: "center", opacity: busy === "analyze" ? 0.6 : 1 }}>
              {busy === "analyze" ? <Loader2 style={{ width: 14, height: 14, marginRight: 8 }} className="animate-spin" /> : <Sparkles style={{ width: 14, height: 14, marginRight: 8 }} />}
              Analyze + Direct
            </button>
          )}
        </div>

        {/* Iteration stack */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {iterations.length === 0 ? (
            <div
              style={{
                border: "1px dashed var(--line)",
                borderRadius: "var(--radius)",
                padding: 48,
                textAlign: "center",
                fontSize: 13,
                color: "var(--muted)",
              }}
            >
              No iterations yet. Click "Analyze + Direct" to generate the first one.
            </div>
          ) : (
            iterations
              .slice()
              .reverse()
              .map((it) => (
                <IterationCard
                  key={it.id}
                  iteration={it}
                  isLatest={it.id === latest?.id}
                  isV11={isV11}
                  busy={busy}
                  onRender={(provider, sku, resolution) => handleRender(it.id, provider, sku, resolution)}
                  onRefine={(p) => handleRefine(it.id, p)}
                  onRate={(p) => handleRate(it.id, p)}
                  onRerender={(provider) => handleRerender(it.id, provider)}
                  onRerenderWithSku={(sku, resolution) => handleRerender(
                    it.id,
                    isNativeKlingSku(sku) ? "kling" : isNativeRunwaySku(sku) ? "runway" : "atlas",
                    sku,
                    resolution,
                  )}
                  onJudgeOverrideSuccess={reload}
                />
              ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Editable label (click-to-edit) ───

function EditableLabel({
  value,
  placeholder,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  onSave: (v: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          setEditing(false);
          if (draft.trim() !== (value ?? "").trim()) await onSave(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
        style={{
          marginTop: 4,
          width: "100%",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid var(--line)",
          outline: "none",
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.022em",
          color: "var(--ink)",
          fontFamily: "var(--le-font-sans)",
          paddingBottom: 2,
        }}
      />
    );
  }
  return (
    <h2
      onClick={() => setEditing(true)}
      style={{
        marginTop: 4,
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: "-0.022em",
        color: value ? "var(--ink)" : "var(--muted-2)",
        cursor: "text",
        fontFamily: "var(--le-font-sans)",
      }}
      title="Click to edit"
    >
      {value || placeholder}
    </h2>
  );
}

// ─── Promote iteration to recipe ───

function PromoteRecipeControl({
  iteration,
  director,
}: {
  iteration: LabIteration;
  director: NonNullable<LabIteration["director_output_json"]>;
}) {
  const analysis = iteration.analysis_json as { room_type?: string } | null;
  const autoArchetype = useMemo(() => {
    const room = analysis?.room_type ?? "scene";
    const movement = director.camera_movement ?? "motion";
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const slug = Math.random().toString(36).slice(2, 6);
    return `${room}_${movement}_${stamp}_${slug}`;
  }, [analysis?.room_type, director.camera_movement]);

  const [open, setOpen] = useState(false);
  const [archetype, setArchetype] = useState(autoArchetype);
  const [tmpl, setTmpl] = useState(director.prompt);
  const [busy, setBusy] = useState(false);
  const [promoted, setPromoted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (promoted) {
    return (
      <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, background: "rgba(47,138,85,0.08)", padding: "6px 12px", fontSize: 12, color: "var(--good)" }}>
        Promoted to recipe library
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="le-btn-ghost" style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setOpen(true)}>
        <Sparkles style={{ width: 12, height: 12 }} /> Promote to recipe
      </button>
    );
  }

  async function submit() {
    if (!archetype.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await promoteRecipe({ iteration_id: iteration.id, archetype: archetype.trim(), prompt_template: tmpl.trim() });
      setPromoted(true);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="le-card-flat" style={{ marginTop: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="le-d-label">Promote to recipe library</span>
      <div>
        <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 5 }}>Archetype name <span style={{ opacity: 0.6 }}>(auto-filled, edit if you want)</span></label>
        <input
          value={archetype}
          onChange={(e) => setArchetype(e.target.value)}
          style={{ ...INPUT_STYLE, fontFamily: "var(--le-font-mono)", fontSize: 12 }}
        />
      </div>
      <div>
        <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 5 }}>Prompt template (use this verbatim on similar photos)</label>
        <textarea
          value={tmpl}
          onChange={(e) => setTmpl(e.target.value)}
          style={{ ...TEXTAREA_STYLE, minHeight: 60, fontFamily: "var(--le-font-mono)", fontSize: 12 }}
        />
      </div>
      {err && <div style={{ fontSize: 12, color: "var(--bad)" }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="le-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="le-btn-dark" onClick={submit} disabled={!archetype.trim() || busy} style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: (!archetype.trim() || busy) ? 0.5 : 1 }}>
          {busy ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : null}
          Promote
        </button>
      </div>
    </div>
  );
}

// ─── Retrieval chips (few-shot + recipe indicators) ───

function RetrievalChips({ metadata }: { metadata: LabIteration["retrieval_metadata"] }) {
  if (!metadata) return null;
  const exemplars = metadata.exemplars ?? [];
  const losers = metadata.losers ?? [];
  const recipe = metadata.recipe;
  if (exemplars.length === 0 && losers.length === 0 && !recipe) return null;
  const chipBase: CSSProperties = { borderRadius: 6, padding: "2px 7px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" };
  return (
    <>
      {exemplars.length > 0 && (
        <span
          style={{ ...chipBase, background: "var(--line)", color: "var(--ink-2)" }}
          title={exemplars.map((e) => `${e.rating}★ · ${e.camera_movement} · d=${e.distance.toFixed(3)}\n   ${e.prompt}`).join("\n\n")}
        >
          Based on {exemplars.length} similar {exemplars.length === 1 ? "win" : "wins"}
        </span>
      )}
      {losers.length > 0 && (
        <span
          style={{ ...chipBase, background: "rgba(196,74,74,0.08)", color: "var(--bad)" }}
          title={losers.map((e) => `${e.rating}★ · ${e.camera_movement} · d=${e.distance.toFixed(3)}\n   ${e.prompt}`).join("\n\n")}
        >
          Avoiding {losers.length} {losers.length === 1 ? "loser" : "losers"}
        </span>
      )}
      {recipe && (
        <span
          style={{ ...chipBase, background: "rgba(47,138,85,0.08)", color: "var(--good)" }}
          title={`${recipe.prompt_template}\n\ndistance ${recipe.distance.toFixed(3)}`}
        >
          Recipe · {recipe.archetype}
        </span>
      )}
    </>
  );
}

// ─── Judge chip + override panel ───

function JudgeChip({
  iteration,
  onOverrideSuccess,
}: {
  iteration: LabIteration;
  onOverrideSuccess: () => void;
}) {
  const [showOverride, setShowOverride] = useState(false);

  // Audit C C2: show Override button even when judge errored — these are
  // exactly the iterations you'd want to calibrate. OverridePanel handles
  // null judge_rating_json via ??3 defaults. Only show pure "failed" state
  // when judge_rating_json is also null (see Fix 7 for that precedence).
  if (iteration.judge_error && iteration.judge_rating_json == null) {
    return (
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)" }}>
          <span style={{ borderRadius: 6, background: "rgba(11,11,16,0.06)", padding: "2px 7px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-2)" }}>
            Judge failed
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200, color: "var(--muted-2)" }} title={iteration.judge_error}>
            {iteration.judge_error.slice(0, 60)}
          </span>
          <button
            type="button"
            onClick={() => setShowOverride((v) => !v)}
            className="le-btn-ghost"
            style={{ fontSize: 10, padding: "2px 8px" }}
          >
            {showOverride ? "Cancel" : "Override"}
          </button>
        </div>
        {showOverride && (
          <OverridePanel
            iteration={iteration}
            panelNote="(judge failed — start from scratch)"
            onCancel={() => setShowOverride(false)}
            onSuccess={() => {
              setShowOverride(false);
              onOverrideSuccess();
            }}
          />
        )}
      </div>
    );
  }

  // Audit C C3: if judge_rating_json is present, show it regardless of
  // judge_error — a retry failure on a previously-judged iteration must not
  // flip the display from "5/5 Motion 5 …" to "Judge failed".
  // Show rating dimmed when judge_error is also set.
  if (iteration.judge_rating_overall == null) return null;

  const j = iteration.judge_rating_json;
  const flags = j?.hallucination_flags ?? [];
  // Dim the chip row if a retry error was stamped on top of a good rating.
  const hasStaleError = !!iteration.judge_error;

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Chip row — dim when a stale retry error is also present */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 11, fontVariantNumeric: "tabular-nums", color: "var(--muted)", opacity: hasStaleError ? 0.6 : 1 }}>
        <span style={{ borderRadius: 6, background: "rgba(11,11,16,0.06)", padding: "2px 8px", fontWeight: 600, color: "var(--ink)" }}>
          Judge: {iteration.judge_rating_overall}/5
        </span>
        {hasStaleError && (
          <span
            style={{ borderRadius: 6, background: "rgba(182,128,44,0.08)", padding: "2px 6px", fontSize: 10, color: "var(--warn)" }}
            title={iteration.judge_error ?? "retry error"}
          >
            retry err
          </span>
        )}
        {j && (
          <>
            <span title="motion faithfulness">Motion {j.motion_faithfulness}</span>
            <span style={{ color: "var(--line)" }}>·</span>
            <span title="geometry coherence">Geom {j.geometry_coherence}</span>
            <span style={{ color: "var(--line)" }}>·</span>
            <span title="room consistency">Room {j.room_consistency}</span>
            <span style={{ color: "var(--line)" }}>·</span>
            <span title="judge confidence">conf {j.confidence}</span>
          </>
        )}
        {flags.length > 0 && (
          <>
            <span style={{ color: "var(--line)" }}>·</span>
            <span>
              {flags.map((f) => (
                <span
                  key={f}
                  style={{ marginRight: 4, borderRadius: 5, background: "rgba(182,128,44,0.08)", padding: "2px 6px", fontSize: 10, color: "var(--warn)" }}
                >
                  {f}
                </span>
              ))}
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => setShowOverride((v) => !v)}
          className="le-btn-ghost"
          style={{ marginLeft: 4, fontSize: 10, padding: "2px 8px" }}
        >
          {showOverride ? "Cancel" : "Override"}
        </button>
      </div>

      {/* Override panel */}
      {showOverride && (
        <OverridePanel
          iteration={iteration}
          onCancel={() => setShowOverride(false)}
          onSuccess={() => {
            setShowOverride(false);
            onOverrideSuccess();
          }}
        />
      )}
    </div>
  );
}

function OverridePanel({
  iteration,
  onCancel,
  onSuccess,
  panelNote,
}: {
  iteration: LabIteration;
  onCancel: () => void;
  onSuccess: () => void;
  /** Optional note shown in the panel header (e.g. when judge failed). */
  panelNote?: string;
}) {
  const j = iteration.judge_rating_json;

  const [motionFaithfulness, setMotionFaithfulness] = useState<number>(j?.motion_faithfulness ?? 3);
  const [geometryCoherence, setGeometryCoherence] = useState<number>(j?.geometry_coherence ?? 3);
  const [roomConsistency, setRoomConsistency] = useState<number>(j?.room_consistency ?? 3);
  const [confidence, setConfidence] = useState<number>(j?.confidence ?? 3);
  const [overall, setOverall] = useState<number>(j?.overall ?? 3);
  const [flags, setFlags] = useState<HallucinationFlag[]>(
    (j?.hallucination_flags ?? []) as HallucinationFlag[],
  );
  const [reasoning, setReasoning] = useState(j?.reasoning ?? "");
  const [correctionReason, setCorrectionReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleFlag(f: HallucinationFlag) {
    setFlags((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );
  }

  async function handleSave() {
    if (!reasoning.trim()) {
      setError("Reasoning is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const corrected: JudgeRubricResult = {
        motion_faithfulness: motionFaithfulness as JudgeRubricResult["motion_faithfulness"],
        geometry_coherence: geometryCoherence as JudgeRubricResult["geometry_coherence"],
        room_consistency: roomConsistency as JudgeRubricResult["room_consistency"],
        hallucination_flags: flags,
        confidence: confidence as JudgeRubricResult["confidence"],
        reasoning: reasoning.trim(),
        overall: overall as JudgeRubricResult["overall"],
      };
      await overrideJudgeRating(iteration.id, corrected, correctionReason.trim() || undefined);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="le-card-flat" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink)" }}>
        Override judge rating
        {panelNote && (
          <span style={{ marginLeft: 8, textTransform: "none", fontWeight: 400, color: "var(--muted)" }}>
            {panelNote}
          </span>
        )}
      </div>

      {/* 5-axis sliders */}
      {(
        [
          ["Motion faithfulness", motionFaithfulness, setMotionFaithfulness],
          ["Geometry coherence", geometryCoherence, setGeometryCoherence],
          ["Room consistency", roomConsistency, setRoomConsistency],
          ["Confidence", confidence, setConfidence],
          ["Overall", overall, setOverall],
        ] as Array<[string, number, (v: number) => void]>
      ).map(([label, value, setter]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 150, flexShrink: 0, fontSize: 12, color: "var(--muted)" }}>{label}</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={value}
            onChange={(e) => setter(Number(e.target.value))}
            style={{ flex: 1, accentColor: "var(--accent)" }}
          />
          <span style={{ width: 18, textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>{value}</span>
        </div>
      ))}

      {/* Hallucination flags */}
      <div>
        <div style={{ marginBottom: 6, fontSize: 12, color: "var(--muted)" }}>Hallucination flags</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {HALLUCINATION_FLAGS.map((f) => {
            const active = flags.includes(f as HallucinationFlag);
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggleFlag(f as HallucinationFlag)}
                style={{
                  borderRadius: 6,
                  border: `1px solid ${active ? "var(--ink)" : "var(--line)"}`,
                  background: active ? "var(--ink)" : "transparent",
                  color: active ? "var(--surface)" : "var(--muted)",
                  padding: "2px 8px",
                  fontSize: 10,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.1s",
                }}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {/* Reasoning (required) */}
      <div>
        <div style={{ marginBottom: 5, fontSize: 12, color: "var(--muted)" }}>
          Reasoning <span style={{ color: "var(--bad)" }}>*</span>
        </div>
        <textarea
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          placeholder="1–3 sentences citing specific frames or defects"
          maxLength={500}
          style={{ ...TEXTAREA_STYLE, minHeight: 60, fontSize: 12 }}
        />
      </div>

      {/* Correction reason (optional) */}
      <div>
        <div style={{ marginBottom: 5, fontSize: 12, color: "var(--muted)" }}>Why you're overriding (optional)</div>
        <textarea
          value={correctionReason}
          onChange={(e) => setCorrectionReason(e.target.value)}
          placeholder="e.g. Judge missed that the geometry warped at second 3"
          style={{ ...TEXTAREA_STYLE, minHeight: 50, fontSize: 12 }}
        />
      </div>

      {error && (
        <div style={{ fontSize: 11.5, color: "var(--bad)" }}>{error}</div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" className="le-btn-dark" onClick={handleSave} disabled={saving} style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: saving ? 0.6 : 1 }}>
          {saving ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Check style={{ width: 12, height: 12 }} />}
          Save override
        </button>
        <button type="button" className="le-btn-ghost" onClick={onCancel} disabled={saving} style={{ opacity: saving ? 0.5 : 1 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── One iteration card ───

function IterationCard({
  iteration,
  isLatest,
  isV11,
  busy,
  onRender,
  onRefine,
  onRate,
  onRerender,
  onRerenderWithSku,
  onJudgeOverrideSuccess,
}: {
  iteration: LabIteration;
  isLatest: boolean;
  /** When true the session is v1.1 — hide SKU picker, camera-movement controls, and rerender buttons. */
  isV11?: boolean;
  busy: string | null;
  onRender: (provider: "kling" | "runway" | null, sku: SkuChoice, resolution?: string) => void;
  onRefine: (payload: { rating: number | null; tags: string[]; comment: string; chatInstruction: string }) => void;
  onRate: (payload: { rating: number | null; tags: string[]; comment: string }) => void;
  onRerender: (provider: "kling" | "runway") => void;
  onRerenderWithSku?: (sku: SkuChoice, resolution?: string | null) => void;
  onJudgeOverrideSuccess?: () => void;
}) {
  const [rating, setRating] = useState<number | null>(iteration.rating);
  const [tags, setTags] = useState<string[]>(iteration.tags ?? []);
  // Single feedback textarea — used by both "Save" (writes user_comment) and
  // "Save and refine" (writes user_comment AND fires refine with the same text
  // as the chat_instruction). Replaced the earlier two-textarea layout where
  // "Notes" and "What should change?" were separate boxes — operators kept
  // typing the rationale in the wrong one. (2026-05-20)
  const [comment, setComment] = useState(iteration.user_comment ?? "");
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Auto-save feedback so operator feedback can't be lost — normal typing
  // triggers a 1.5s debounce; unmount, tab-hidden, and textarea blur all
  // force an immediate flush. The flush on unmount uses fetch keepalive so
  // it survives even if the browser is closing the tab.
  const hasMountedRef = useRef(false);
  const ratingRef = useRef(rating);
  const tagsRef = useRef(tags);
  const commentRef = useRef(comment);
  const lastSavedRef = useRef({
    rating: iteration.rating,
    tags: iteration.tags ?? [],
    comment: iteration.user_comment ?? "",
  });
  useEffect(() => { ratingRef.current = rating; }, [rating]);
  useEffect(() => { tagsRef.current = tags; }, [tags]);
  useEffect(() => { commentRef.current = comment; }, [comment]);

  const isDirty = useCallback(() => {
    const s = lastSavedRef.current;
    const ratingEq = s.rating === ratingRef.current;
    const tagsEq = JSON.stringify([...s.tags].sort()) === JSON.stringify([...tagsRef.current].sort());
    const commentEq = s.comment === commentRef.current;
    return !(ratingEq && tagsEq && commentEq);
  }, []);

  const flushSave = useCallback(async (useKeepalive: boolean) => {
    if (!isDirty()) return;
    const body = {
      iteration_id: iteration.id,
      rating: ratingRef.current,
      tags: tagsRef.current.length > 0 ? tagsRef.current : null,
      comment: commentRef.current.trim() ? commentRef.current : null,
    };
    try {
      if (useKeepalive) {
        // Fire-and-forget via fetch keepalive — survives page unload / tab close.
        // Skip auth header: browser will send cookies, server requireAdmin
        // accepts session cookies in addition to bearer tokens.
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
        fetch("/api/admin/prompt-lab/rate", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          keepalive: true,
        }).catch(() => { /* best-effort during unload */ });
      } else {
        await rateIteration(body);
      }
      lastSavedRef.current = {
        rating: ratingRef.current,
        tags: [...tagsRef.current],
        comment: commentRef.current,
      };
      setAutoSaveState("saved");
      setTimeout(() => setAutoSaveState("idle"), 2000);
    } catch {
      setAutoSaveState("error");
    }
  }, [iteration.id, isDirty]);

  // Debounced save on every change (1.5s after last edit).
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (!isDirty()) return;
    setAutoSaveState("saving");
    const handle = setTimeout(() => { flushSave(false); }, 1500);
    return () => clearTimeout(handle);
  }, [rating, tags, comment, isDirty, flushSave]);

  // Flush on unmount (navigate within app) + tab hide / page unload.
  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") flushSave(true); };
    const onPageHide = () => flushSave(true);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      flushSave(true);
    };
  }, [flushSave]);
  const [renderForReal, setRenderForReal] = useState(false);
  const [providerChoice, setProviderChoice] = useState<"auto" | "kling" | "runway">("auto");
  const [showAdvancedProvider, setShowAdvancedProvider] = useState(false);
  const [sku, setSku] = useState<SkuChoice>(() => {
    const mu = iteration.model_used;
    // v1.1 iterations — restore the exact SKU if it's in the v1.1 catalog.
    if (isV11) {
      if (mu && (V1_1_LAB_SKUS as readonly string[]).includes(mu)) return mu as V1_1LabSku;
      return V1_1_DEFAULT_SKU;
    }
    // Map legacy native-kling iterations (model_used=null, provider="kling")
    // and legacy "kling-v2-native" sentinel to the dropdown's native entry.
    if (mu === "kling-v2-native" || (!mu && iteration.provider === "kling")) return "kling-v2-native";
    // Same for native Runway iterations.
    if (mu === "runway-gen4-native" || (!mu && iteration.provider === "runway")) return "runway-gen4-native";
    if (mu && (SKU_DROPDOWN_OPTIONS as readonly string[]).includes(mu)) return mu as SkuChoice;
    return V1_DEFAULT_SKU;
  });

  // v1.1 resolution picker state. Initialized to the first supported resolution
  // for the initial SKU. When the SKU changes, reset to the new SKU's default.
  const [resolution, setResolution] = useState<string>(() => {
    const initialSku = isV11
      ? (() => {
          const mu = iteration.model_used;
          if (mu && (V1_1_LAB_SKUS as readonly string[]).includes(mu)) return mu;
          return V1_1_DEFAULT_SKU;
        })()
      : V1_1_DEFAULT_SKU;
    return getSupportedResolutions(initialSku)[0];
  });

  // v1.1 re-render state — two-step: pick SKU → pick quality → confirm.
  // Only one SKU's quality picker is open at a time.
  const [pendingRerenderSku, setPendingRerenderSku] = useState<string | null>(null);
  const [pendingRerenderResolution, setPendingRerenderResolution] = useState<string>("");

  const director = iteration.director_output_json;
  const analysis = iteration.analysis_json as Record<string, unknown> | null;

  function toggleTag(t: string) {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  const rendering = busy === `render-${iteration.id}`;
  const refining = busy === `refine-${iteration.id}`;
  const rating_saving = busy === `rate-${iteration.id}`;

  return (
    <Card padding={0} style={{
      border: isLatest ? "2px solid var(--ink)" : "1px solid var(--line)",
      opacity: isLatest ? 1 : 0.82,
      position: "relative",
    }}>
      {isLatest && (
        <div style={{
          position: "absolute",
          top: -1,
          left: -1,
          borderRadius: "0 0 var(--radius-sm) 0",
          background: "var(--ink)",
          padding: "3px 10px",
          fontSize: 9.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.10em",
          color: "var(--surface)",
        }}>
          Latest · active
        </div>
      )}

      <div style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: isLatest ? 14 : 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span className="le-d-label">Iteration {iteration.iteration_number}</span>
            {iteration.order_id && (
              <span style={{ borderRadius: 6, background: "rgba(11,11,16,0.06)", padding: "2px 6px", fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.08em", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                {iteration.order_id}
              </span>
            )}
            {(iteration.model_used || iteration.provider) && (
              <span style={{ borderRadius: 6, background: "rgba(11,11,16,0.06)", padding: "2px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-2)" }} title={iteration.model_used ? `provider: ${iteration.provider ?? "—"}` : undefined}>
                {iteration.model_used ?? iteration.provider}
              </span>
            )}
            <RetrievalChips metadata={iteration.retrieval_metadata} />
          </div>
          <span style={{ fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
            {new Date(iteration.created_at).toLocaleString()}
          </span>
        </div>

        {/* Analysis summary */}
        {analysis && (
          <div style={{ marginTop: 16, display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr", fontSize: 12 }}>
            <div style={{ color: "var(--muted)" }}>
              Room: <span style={{ fontWeight: 600, color: "var(--ink)" }}>{String(analysis.room_type)}</span>
              <span style={{ marginLeft: 12 }}>Depth: <span style={{ fontWeight: 600, color: "var(--ink)" }}>{String(analysis.depth_rating)}</span></span>
              <span style={{ marginLeft: 12 }}>Aesthetic: <span style={{ fontWeight: 600, color: "var(--ink)" }}>{String(analysis.aesthetic_score)}</span></span>
            </div>
            <div style={{ color: "var(--muted)" }}>
              Suggested motion: <span style={{ fontWeight: 600, color: "var(--ink)" }}>{String(analysis.suggested_motion ?? "—")}</span>
            </div>
            {Array.isArray(analysis.key_features) && (
              <div style={{ gridColumn: "span 2", color: "var(--muted)" }}>
                Features: <span style={{ color: "var(--ink)" }}>{(analysis.key_features as string[]).join(" · ")}</span>
              </div>
            )}
            {typeof analysis.composition === "string" && (
              <div style={{ gridColumn: "span 2", fontStyle: "italic", color: "var(--muted)" }}>{analysis.composition as string}</div>
            )}
          </div>
        )}

        {/* Director output */}
        {director && (
          <div style={{ marginTop: 20, borderLeft: "2px solid rgba(11,11,16,0.12)", paddingLeft: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ borderRadius: 6, background: "var(--ink)", color: "var(--surface)", padding: "2px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {director.camera_movement}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{director.duration_seconds}s</span>
            </div>
            <p style={{ marginTop: 8, fontFamily: "var(--le-font-mono)", fontSize: 13, lineHeight: 1.6, color: "var(--ink)" }}>{director.prompt}</p>
          </div>
        )}

        {iteration.user_comment && iteration.user_comment.startsWith("[refiner rationale]") && (
          <div style={{ marginTop: 12, borderRadius: "var(--radius-sm)", background: "var(--line-2)", padding: 12, fontSize: 12, fontStyle: "italic", color: "var(--muted)" }}>
            {iteration.user_comment.replace("[refiner rationale] ", "Why: ")}
          </div>
        )}

        {/* Queued for render (waiting for provider slot) */}
        {!iteration.clip_url && !iteration.provider_task_id && iteration.render_queued_at && !iteration.render_error && (
          <div style={{ marginTop: 20, display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 8, background: "rgba(115,80,195,0.07)", padding: "6px 12px", fontSize: 12, color: "var(--accent)" }}>
            <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
            Queued for {iteration.provider ?? "render"} — waiting for slot
            <span style={{ opacity: 0.7 }}>
              · auto-submits when capacity opens (cron checks every minute)
            </span>
          </div>
        )}

        {/* Pending render indicator */}
        {!iteration.clip_url && iteration.provider_task_id && !iteration.render_error && (
          <div style={{ marginTop: 20, display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 8, background: "rgba(182,128,44,0.07)", padding: "6px 12px", fontSize: 12, color: "var(--warn)" }}>
            <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
            Rendering on {iteration.provider}
            {iteration.render_submitted_at && (
              <span style={{ opacity: 0.7 }}>
                · submitted {new Date(iteration.render_submitted_at).toLocaleTimeString()}
              </span>
            )}
            <span style={{ opacity: 0.7 }}>· cron finalizes (safe to leave this page)</span>
          </div>
        )}

        {/* Render error */}
        {iteration.render_error && !iteration.clip_url && (
          <div style={{ marginTop: 20, borderRadius: "var(--radius-sm)", background: "rgba(196,74,74,0.06)", border: "1px solid rgba(196,74,74,0.2)", padding: 12, fontSize: 12, color: "var(--bad)" }}>
            <div style={{ fontWeight: 600 }}>Render failed</div>
            <div style={{ marginTop: 4, opacity: 0.8 }}>{iteration.render_error}</div>
          </div>
        )}

        {/* Clip player */}
        {iteration.clip_url && (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            <video
              key={iteration.clip_url}
              src={iteration.clip_url}
              controls
              playsInline
              preload="none"
              style={{ width: "100%", maxWidth: 480, borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", display: "block" }}
            />
            <a
              href={iteration.clip_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: "var(--muted)", textDecoration: "underline" }}
            >
              Open clip in new tab
            </a>

            {/* ── Lane C: qualitative model feedback ──────────────────────────
                Sits flush below the video player, above judge/rating UI.
                Do NOT move this block — Lane A owns the SKU/resolution
                selector area at the top of the card. */}
            <ModelFeedbackPanel iterationId={iteration.id} />
          </div>
        )}

        {/* Judge pending — clip has landed but judge cron hasn't run yet. */}
        {iteration.clip_url
          && iteration.judge_rating_overall == null
          && iteration.judge_error == null
          && (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--muted)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 6, background: "rgba(11,11,16,0.06)", padding: "2px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
                Judging…
              </span>
              <span style={{ opacity: 0.6 }}>Gemini auto-judge runs every minute</span>
            </div>
          )}

        {/* Judge chip — appears when judge has run (or errored) */}
        {(iteration.judge_rating_overall != null || iteration.judge_error != null) && (
          <JudgeChip
            iteration={iteration}
            onOverrideSuccess={onJudgeOverrideSuccess ?? (() => {})}
          />
        )}

        {/* Try with different provider — hidden on v1.1 (uses SKU picker instead) */}
        {!isV11 && director && (iteration.clip_url || iteration.render_error) && (
          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Try with:</span>
            {(["kling", "runway"] as const)
              .filter((p) => p !== iteration.provider)
              .map((p) => (
                <button
                  key={p}
                  type="button"
                  className="le-btn-ghost"
                  disabled={busy === `rerender-${iteration.id}`}
                  onClick={() => onRerender(p)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, opacity: busy === `rerender-${iteration.id}` ? 0.5 : 1 }}
                >
                  {busy === `rerender-${iteration.id}` ? (
                    <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
                  ) : (
                    <Play style={{ width: 11, height: 11 }} />
                  )}
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
          </div>
        )}

        {/* Try another SKU (v1 Atlas) — hidden on v1.1 */}
        {!isV11 && (iteration.clip_url || iteration.render_error) && onRerenderWithSku && (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: 12 }}>
            <span style={{ color: "var(--muted)" }}>
              {iteration.render_error ? "Retry on another SKU:" : "Try another SKU:"}
            </span>
            {SKU_DROPDOWN_OPTIONS
              .filter((s) => s !== iteration.model_used
                && !(s === "kling-v2-native" && iteration.provider === "kling")
                && !(s === "runway-gen4-native" && iteration.provider === "runway"))
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  className="le-btn-ghost"
                  onClick={() => onRerenderWithSku(s)}
                  disabled={busy === `rerender-${iteration.id}`}
                  style={{ fontSize: 11, opacity: busy === `rerender-${iteration.id}` ? 0.5 : 1 }}
                  title={
                    s === "kling-v2-native" ? "Native Kling v2.0 — uses pre-paid credits"
                      : s === "runway-gen4-native" ? "Runway Gen-4 turbo — strong on exteriors / drone"
                        : `$${(V1_SKU_COST_CENTS[s] / 100).toFixed(2)}/5s`
                  }
                >
                  {V1_SKU_LABELS[s].replace(" (default)", "")}
                </button>
              ))}
          </div>
        )}

        {/* Re-render (v1.1 catalog) — two-step: pick SKU → pick quality → confirm */}
        {isV11 && (iteration.clip_url || iteration.render_error) && onRerenderWithSku && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <span style={{ color: "var(--muted)" }}>
                {iteration.render_error ? "Retry render with:" : "Re-render with:"}
              </span>
              {V1_1_LAB_SKUS
                .filter((s) => s !== iteration.model_used)
                .map((s) => {
                  const isPending = pendingRerenderSku === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      className="le-btn-ghost"
                      onClick={() => {
                        if (isPending) {
                          // Toggle off if user clicks the same SKU again.
                          setPendingRerenderSku(null);
                          setPendingRerenderResolution("");
                        } else {
                          setPendingRerenderSku(s);
                          setPendingRerenderResolution(getSupportedResolutions(s)[0]);
                        }
                      }}
                      disabled={busy === `rerender-${iteration.id}`}
                      style={{
                        fontSize: 11,
                        opacity: busy === `rerender-${iteration.id}` ? 0.5 : 1,
                        background: isPending ? "rgba(115,80,195,0.08)" : undefined,
                        borderColor: isPending ? "var(--accent)" : undefined,
                        color: isPending ? "var(--accent)" : undefined,
                      }}
                      title={v11SkuCostLabel(s)}
                    >
                      {v11SkuLabel(s)}
                    </button>
                  );
                })}
            </div>

            {/* Inline quality picker + Confirm — appears when a SKU is selected */}
            {pendingRerenderSku && (
              <div
                style={{
                  marginTop: 8,
                  padding: "10px 12px",
                  border: "1px solid var(--accent)",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(115,80,195,0.04)",
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <span style={{ color: "var(--ink-2)", fontSize: 12, fontFamily: "var(--le-font-sans)" }}>
                  Re-render with <strong>{v11SkuLabel(pendingRerenderSku as V1_1LabSku)}</strong>
                </span>
                {getSupportedResolutions(pendingRerenderSku).length > 1 ? (
                  <>
                    <label style={{ color: "var(--muted)", fontSize: 12 }}>Quality:</label>
                    <select
                      value={pendingRerenderResolution}
                      onChange={(e) => setPendingRerenderResolution(e.target.value)}
                      disabled={busy === `rerender-${iteration.id}`}
                      style={{
                        padding: "4px 9px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--line)",
                        background: "var(--surface)",
                        fontSize: 12,
                        fontFamily: "inherit",
                        color: "var(--ink)",
                        cursor: "pointer",
                      }}
                    >
                      {getSupportedResolutions(pendingRerenderSku).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>
                    {pendingRerenderResolution} (only option)
                  </span>
                )}
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                  <button
                    type="button"
                    className="le-btn-ghost"
                    onClick={() => {
                      setPendingRerenderSku(null);
                      setPendingRerenderResolution("");
                    }}
                    disabled={busy === `rerender-${iteration.id}`}
                    style={{ fontSize: 11 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="le-btn-primary"
                    onClick={() => {
                      const sku = pendingRerenderSku as V1_1LabSku;
                      const res = pendingRerenderResolution;
                      setPendingRerenderSku(null);
                      setPendingRerenderResolution("");
                      onRerenderWithSku(sku, res);
                    }}
                    disabled={busy === `rerender-${iteration.id}` || !pendingRerenderResolution}
                    style={{ fontSize: 11 }}
                  >
                    {busy === `rerender-${iteration.id}` ? "Submitting…" : "Confirm"}
                  </button>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Promote to recipe (on 4+ star iterations) */}
        {typeof iteration.rating === "number" && iteration.rating >= 4 && director && (
          <PromoteRecipeControl iteration={iteration} director={director} />
        )}

        {/* v1.1 note — only shown for Seedance push-in SKU (the push-in override applies only when seedance is selected) */}
        {isV11 && director && sku === "seedance-pro-pushin" && (
          <div style={{ marginTop: 16, borderRadius: "var(--radius-sm)", background: "rgba(115,80,195,0.06)", border: "1px solid rgba(115,80,195,0.15)", padding: "8px 12px", fontSize: 12, color: "var(--accent)", fontFamily: "var(--le-font-sans)" }}>
            v1.1 — Seedance 2.0 push-in. Camera movement forced to push-in; speed-ramp polish applied on download.
          </div>
        )}

        {/* Render controls (latest only, not currently rendering) */}
        {isLatest && !iteration.clip_url && !iteration.provider_task_id && director && (
          <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ink-2)", cursor: "pointer", userSelect: "none" as const }}>
              <input
                type="checkbox"
                checked={renderForReal}
                onChange={(e) => {
                  setRenderForReal(e.target.checked);
                  if (!e.target.checked) {
                    setProviderChoice("auto");
                    setShowAdvancedProvider(false);
                  }
                }}
                style={{ accentColor: "var(--accent)", cursor: "pointer" }}
              />
              {isV11 ? `Render for real (${v11SkuLabel(sku as V1_1LabSku)})` : "Render for real (~$0.36–$1.11 per clip depending on SKU)"}
            </label>

            {/* v1.1 SKU dropdown — shown on v1.1 sessions, populated from V1_1_LAB_SKUS */}
            {isV11 && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                <label style={{ color: "var(--muted)" }}>SKU:</label>
                <select
                  value={sku}
                  onChange={(e) => {
                    const newSku = e.target.value as V1_1LabSku;
                    setSku(newSku);
                    // Reset resolution to the new SKU's first supported value.
                    setResolution(getSupportedResolutions(newSku)[0]);
                  }}
                  disabled={!renderForReal || rendering}
                  style={{ padding: "5px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--surface)", fontSize: 12, fontFamily: "inherit", color: "var(--ink)", cursor: "pointer", opacity: (!renderForReal || rendering) ? 0.5 : 1 }}
                >
                  {V1_1_LAB_SKUS.map((s) => (
                    <option key={s} value={s}>
                      {v11SkuLabel(s)} — {v11SkuCostLabel(s)}
                    </option>
                  ))}
                </select>
                <span style={{ borderRadius: 6, background: "rgba(11,11,16,0.06)", padding: "2px 8px", fontSize: 10, color: "var(--muted)" }}>
                  {v11SkuCostLabel(sku as V1_1LabSku)}
                </span>

                {/* Resolution picker — only shown when the current SKU offers >1 option */}
                {getSupportedResolutions(sku).length > 1 && (
                  <>
                    <label style={{ color: "var(--muted)" }}>Quality:</label>
                    <select
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      disabled={!renderForReal || rendering}
                      style={{ padding: "5px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--surface)", fontSize: 12, fontFamily: "inherit", color: "var(--ink)", cursor: "pointer", opacity: (!renderForReal || rendering) ? 0.5 : 1 }}
                    >
                      {getSupportedResolutions(sku).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}

            {/* v1 SKU dropdown — shown on v1 sessions */}
            {!isV11 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                  <label style={{ color: "var(--muted)" }}>SKU:</label>
                  <select
                    value={sku}
                    onChange={(e) => setSku(e.target.value as SkuChoice)}
                    disabled={!renderForReal || rendering}
                    style={{ padding: "5px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--surface)", fontSize: 12, fontFamily: "inherit", color: "var(--ink)", cursor: "pointer", opacity: (!renderForReal || rendering) ? 0.5 : 1 }}
                  >
                    {SKU_DROPDOWN_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {V1_SKU_LABELS[s]} — {s === "kling-v2-native" ? "credits" : `≈ $${(V1_SKU_COST_CENTS[s] / 100).toFixed(2)}`}
                      </option>
                    ))}
                  </select>
                  <span style={{ borderRadius: 6, background: "rgba(11,11,16,0.06)", padding: "2px 8px", fontFamily: "var(--le-font-mono)", fontSize: 10, color: "var(--muted)" }}>
                    {isNativeKlingSku(sku as SkuChoice) ? "credits" : `≈ $${(V1_SKU_COST_CENTS[sku as SkuChoice] / 100).toFixed(2)}/5s`}
                  </span>
                </div>
                <SkuAffinityHint
                  cameraMovement={(director as { camera_movement?: string } | null)?.camera_movement ?? null}
                  sku={sku}
                  onPickSuggested={(s) => setSku(s as SkuChoice)}
                />
                {showAdvancedProvider ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <select
                      value={providerChoice}
                      onChange={(e) => setProviderChoice(e.target.value as "auto" | "kling" | "runway")}
                      disabled={!renderForReal || rendering}
                      style={{ padding: "5px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--surface)", fontSize: 12, fontFamily: "inherit", color: "var(--ink)", cursor: "pointer", opacity: (!renderForReal || rendering) ? 0.5 : 1 }}
                      title="Provider override. Default is Atlas (routes via your selected SKU). Kling native burns pre-paid credits instead of Atlas billing. Runway uses Gen-4 instead of Kling."
                    >
                      <option value="auto">Atlas (default)</option>
                      <option value="kling">Kling native</option>
                      <option value="runway">Runway Gen-4</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => { setProviderChoice("auto"); setShowAdvancedProvider(false); }}
                      disabled={!renderForReal || rendering}
                      style={{ fontSize: 10, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", opacity: (!renderForReal || rendering) ? 0.5 : 1 }}
                      title="Reset to Atlas (default) and collapse"
                    >
                      ◂
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAdvancedProvider(true)}
                    disabled={!renderForReal || rendering}
                    style={{ fontSize: 10, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", opacity: (!renderForReal || rendering) ? 0.5 : 1 }}
                    title="Show provider override (Kling native / Runway)"
                  >
                    Advanced ▸
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              className={renderForReal ? "le-btn-dark" : "le-btn-ghost"}
              disabled={!renderForReal || rendering}
              onClick={() => {
                if (isV11) {
                  // v1.1: pass the selected SKU and resolution to the server.
                  // Server routes Seedance to seedance-pro-pushin with push-in override;
                  // other v1.1 SKUs render as-is with the director prompt.
                  onRender(null, sku, resolution);
                } else if (isNativeKlingSku(sku as SkuChoice)) {
                  onRender("kling", sku);
                } else if (isNativeRunwaySku(sku as SkuChoice)) {
                  onRender("runway", sku);
                } else {
                  onRender(providerChoice === "auto" ? null : providerChoice, sku);
                }
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: (!renderForReal || rendering) ? 0.5 : 1 }}
            >
              {rendering ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <Play style={{ width: 13, height: 13 }} />}
              {rendering ? "Rendering…" : "Render clip"}
            </button>
          </div>
        )}

        {/* Feedback — rating available on any iteration; refine latest only */}
        {director && (
          <div style={{ marginTop: 24, borderTop: "1px solid var(--line-2)", paddingTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="le-d-label">Rate this iteration</span>
              <span style={{ fontSize: 10, fontVariantNumeric: "tabular-nums", color: "var(--muted)" }} aria-live="polite">
                {autoSaveState === "saving" ? "saving…"
                  : autoSaveState === "saved" ? "saved"
                  : autoSaveState === "error" ? "auto-save failed — use Save rating button"
                  : ""}
              </span>
            </div>

            {/* Stars */}
            <div>
              <span className="sr-only">Rate this iteration</span>
              <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(rating === n ? null : n)}
                    style={{ padding: 4, background: "none", border: "none", cursor: "pointer" }}
                    aria-label={`${n} stars`}
                  >
                    <Star
                      style={{ width: 20, height: 20 }}
                      fill={rating != null && n <= rating ? "var(--ink)" : "none"}
                      stroke={rating != null && n <= rating ? "var(--ink)" : "var(--line)"}
                      strokeWidth={1.5}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <span className="le-d-label">Tags</span>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
                {RATING_TAGS.map((t) => {
                  const active = tags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      style={{
                        borderRadius: "var(--radius-pill)",
                        border: `1px solid ${active ? "var(--ink)" : "var(--line)"}`,
                        background: active ? "var(--ink)" : "transparent",
                        color: active ? "var(--surface)" : "var(--muted)",
                        padding: "4px 10px",
                        fontSize: 10,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        transition: "all 0.1s",
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Feedback — single textarea, two buttons.
                Save: writes to user_comment only (no new iteration).
                Save and refine: writes user_comment AND fires refine with the
                same text as chat_instruction → creates a refined iteration.
                The Refine endpoint requires chat_instruction to be non-empty,
                so Save-and-refine is disabled when the textarea is empty. */}
            <div>
              <span className="le-d-label">
                Feedback (optional){!isLatest && <span style={{ color: "var(--muted-2)", fontWeight: 400 }}> · Save and refine will branch from this iteration</span>}
              </span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onBlur={() => flushSave(false)}
                placeholder="What did/didn't work? e.g. 'the dolly is too fast, make it slower' — Save and refine uses this as the change instruction"
                style={{ ...TEXTAREA_STYLE, marginTop: 8, minHeight: 80 }}
              />
              <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  className="le-btn-ghost"
                  onClick={() => onRate({ rating, tags, comment })}
                  disabled={rating_saving || (rating === null && tags.length === 0 && !comment.trim())}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: (rating_saving || (rating === null && tags.length === 0 && !comment.trim())) ? 0.5 : 1 }}
                >
                  {rating_saving ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Star style={{ width: 12, height: 12 }} />}
                  Save
                </button>
                <button
                  type="button"
                  className="le-btn-dark"
                  onClick={() => onRefine({ rating, tags, comment, chatInstruction: comment })}
                  disabled={!comment.trim() || refining}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: (!comment.trim() || refining) ? 0.5 : 1 }}
                  title="Save the feedback AND generate a refined iteration using this text as the change instruction"
                >
                  {refining ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <Sparkles style={{ width: 13, height: 13 }} />}
                  Save and refine
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default PromptLab;
