import { Suspense, lazy, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { listListings, type LabListing } from "@/lib/labListingsApi";
import { PageHeading, Card } from "@/components/dashboard/primitives";
import type { LabMode, ModeState } from "../../../../lib/gen2-v21/types.js";

const DirectorsCutLab = lazy(() => import("./DirectorsCutLab"));
const ApprenticeReview = lazy(() => import("./ApprenticeReview"));
const ObservabilityPanel = lazy(() => import("./ObservabilityPanel"));

// "observability" isn't a LabMode in types, so we extend locally
type TabId = LabMode | "observability";

const TAB_ITEMS: { id: TabId; label: string }[] = [
  { id: "directors_cut", label: "Director's Cut" },
  { id: "apprentice_review", label: "Apprentice Review" },
  { id: "observability", label: "Observability" },
];

// ── authedFetch helper (mirrors labListingsApi pattern) ─────────────
async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = init?.body ? { "Content-Type": "application/json" } : {};
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body as T;
}

const LS_PROP_KEY = "v21_last_listing_id";
const LS_TAB_KEY = "v21_last_tab";

export default function V21LabIndex() {
  const [listings, setListings] = useState<LabListing[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>(() => localStorage.getItem(LS_PROP_KEY) ?? "");
  const [activeTab, setActiveTab] = useState<TabId>(() => (localStorage.getItem(LS_TAB_KEY) as TabId | null) ?? "directors_cut");
  const [modeState, setModeState] = useState<ModeState | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [sceneGraphExists, setSceneGraphExists] = useState<boolean | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

  // Load listings
  useEffect(() => {
    listListings()
      .then(({ listings }) => {
        setListings(listings);
        if (!selectedId && listings.length > 0) {
          setSelectedId(listings[0].id);
        }
      })
      .catch(() => setListings([]));
  }, []);

  // Persist selection
  useEffect(() => {
    if (selectedId) localStorage.setItem(LS_PROP_KEY, selectedId);
  }, [selectedId]);

  useEffect(() => {
    localStorage.setItem(LS_TAB_KEY, activeTab);
  }, [activeTab]);

  // Load mode state for current listing
  useEffect(() => {
    if (!selectedId) return;
    setModeState(null);
    authedFetch<ModeState>(`/api/gen2/lab/mode-state?listingId=${encodeURIComponent(selectedId)}`)
      .then(setModeState)
      .catch(() => {/* non-critical */});
  }, [selectedId]);

  // Check if scene graph already exists
  useEffect(() => {
    if (!selectedId) return;
    setSceneGraphExists(null);
    setLoadingGraph(true);
    authedFetch<{ exists: boolean }>(`/api/gen2/lab/extract-scene-graph?check=1&listingId=${encodeURIComponent(selectedId)}`)
      .then(({ exists }) => setSceneGraphExists(exists))
      .catch(() => setSceneGraphExists(false))
      .finally(() => setLoadingGraph(false));
  }, [selectedId]);

  async function handleExtract() {
    if (!selectedId) return;
    setExtracting(true);
    setExtractError(null);
    try {
      await authedFetch("/api/gen2/lab/extract-scene-graph", {
        method: "POST",
        body: JSON.stringify({ listingId: selectedId }),
      });
      setSceneGraphExists(true);
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  // Determine recommended mode mismatch
  const modeMismatch =
    modeState &&
    modeState.recommended_mode !== modeState.current_mode &&
    (modeState.recommended_mode === "directors_cut" || modeState.recommended_mode === "apprentice_review");

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <PageHeading
        eyebrow="Lab · V2.1"
        title="Pair-Picker Lab"
        sub="Select a property, extract its scene graph, then label frame pairs in Director's Cut or let the Apprentice handle routine calls."
      />

      {/* Property selector */}
      <Card padding={20}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)", minWidth: 80 }}>
            Property
          </label>
          {listings === null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
              Loading…
            </div>
          ) : (
            <select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setSceneGraphExists(null);
              }}
              style={{
                padding: "7px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--line)",
                background: "var(--surface)",
                fontSize: 13,
                color: "var(--ink)",
                fontFamily: "var(--le-font-sans)",
                outline: "none",
                minWidth: 240,
              }}
            >
              <option value="" disabled>Select a listing…</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}
        </div>
      </Card>

      {selectedId && (
        <>
          {/* Scene graph extraction */}
          <Card padding={20}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>Scene Graph</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {loadingGraph
                    ? "Checking…"
                    : sceneGraphExists === true
                    ? "Scene graph extracted — ready to label pairs."
                    : sceneGraphExists === false
                    ? "No scene graph yet. Extract to enable pair picking."
                    : ""}
                </div>
              </div>
              {sceneGraphExists === false && (
                <button
                  type="button"
                  className="le-btn-dark"
                  disabled={extracting}
                  onClick={handleExtract}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {extracting && <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />}
                  {extracting ? "Extracting…" : "Extract scene graph"}
                </button>
              )}
              {sceneGraphExists === true && (
                <button
                  type="button"
                  className="le-btn-ghost"
                  disabled={extracting}
                  onClick={handleExtract}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}
                >
                  {extracting && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
                  Re-extract
                </button>
              )}
            </div>
            {extractError && (
              <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "rgba(196,74,74,0.07)", border: "1px solid rgba(196,74,74,0.18)", fontSize: 12.5, color: "var(--bad)" }}>
                {extractError}
              </div>
            )}
          </Card>

          {/* Mode recommendation banner */}
          {modeMismatch && modeState && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(var(--accent-rgb, 99, 102, 241), 0.07)",
                border: "1px solid rgba(var(--accent-rgb, 99, 102, 241), 0.22)",
                fontSize: 13,
                color: "var(--ink-2)",
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>
                Apprentice agreement is{" "}
                <strong>{Math.round(modeState.apprentice_agreement_rate * 100)}%</strong> across{" "}
                {modeState.total_labels} labels — recommended mode is{" "}
                <strong>{modeState.recommended_mode === "directors_cut" ? "Director's Cut" : "Apprentice Review"}</strong>.
              </span>
              <button
                type="button"
                className="le-btn-dark"
                style={{ fontSize: 12, padding: "5px 12px" }}
                onClick={() => {
                  if (modeState.recommended_mode === "directors_cut" || modeState.recommended_mode === "apprentice_review") {
                    setActiveTab(modeState.recommended_mode);
                  }
                }}
              >
                Switch?
              </button>
            </div>
          )}

          {/* Mode tabs */}
          <div style={{ borderBottom: "1px solid var(--line)", display: "flex", gap: 0 }}>
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "10px 20px",
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === tab.id ? "2px solid var(--ink)" : "2px solid transparent",
                  fontSize: 13,
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  color: activeTab === tab.id ? "var(--ink)" : "var(--muted)",
                  cursor: "pointer",
                  fontFamily: "var(--le-font-sans)",
                  marginBottom: -1,
                  transition: "color 0.15s, border-color 0.15s",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab panel */}
          <Suspense
            fallback={
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13, padding: "32px 0" }}>
                <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} />
                Loading…
              </div>
            }
          >
            {activeTab === "directors_cut" && <DirectorsCutLab listingId={selectedId} />}
            {activeTab === "apprentice_review" && <ApprenticeReview listingId={selectedId} />}
            {activeTab === "observability" && <ObservabilityPanel listingId={selectedId} />}
          </Suspense>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
