import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { listListings, type LabListing } from "@/lib/labListingsApi";
import { PageHeading } from "@/components/dashboard/primitives";
import type { LabMode, ModeState } from "../../../../lib/gen2-v21/types.js";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const DirectorsCutLab = lazy(() => import("./DirectorsCutLab"));
const ApprenticeReview = lazy(() => import("./ApprenticeReview"));
const ObservabilityPanel = lazy(() => import("./ObservabilityPanel"));

// "observability" isn't a LabMode in types, so we extend locally
type TabId = LabMode | "observability";

// ── authedFetch helper ─────────────────────────────────────────────
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

const VALID_TABS: TabId[] = ["directors_cut", "apprentice_review", "observability"];

export default function V21LabIndex() {
  // URL deep-link: /lab/v21?listingId=X overrides localStorage.
  // URL tab: /lab/v21?tab=apprentice_review|observability|directors_cut overrides localStorage.
  const urlListingId = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("listingId") ?? ""
    : "";
  const urlTab = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("tab") as TabId | null)
    : null;
  const validUrlTab = urlTab && VALID_TABS.includes(urlTab) ? urlTab : null;

  const [listings, setListings] = useState<LabListing[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>(
    () => urlListingId || localStorage.getItem(LS_PROP_KEY) || ""
  );
  const [activeTab, setActiveTab] = useState<TabId>(
    () => validUrlTab ?? (localStorage.getItem(LS_TAB_KEY) as TabId | null) ?? "directors_cut"
  );
  const [modeState, setModeState] = useState<ModeState | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [sceneGraphExists, setSceneGraphExists] = useState<boolean | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);
  // Tracks whether we've already auto-fired extract for this selectedId
  const autoExtractFiredRef = useRef<string>("");

  // Load listings. If the URL-selected listing isn't in the dropdown
  // (V2 scene graph exists for a property that isn't a prompt_lab_listing),
  // we still keep the selection — the Tabs gate on sceneGraphExists, not on
  // dropdown membership, so the labeling UI still works.
  useEffect(() => {
    listListings()
      .then(({ listings }) => {
        // If URL gave us a listingId not in the dropdown, synthesize a row so
        // the Select shows something selected instead of going blank.
        if (urlListingId && !listings.some((l) => l.id === urlListingId)) {
          const synthetic: LabListing = {
            id: urlListingId,
            name: `Property ${urlListingId.slice(0, 8)} (V2 only)`,
          } as LabListing;
          listings = [synthetic, ...listings];
        }
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
    // Reset auto-extract guard when selection changes
    autoExtractFiredRef.current = "";
    authedFetch<{ exists: boolean }>(`/api/gen2/lab/extract-scene-graph?check=1&listingId=${encodeURIComponent(selectedId)}`)
      .then(({ exists }) => setSceneGraphExists(exists))
      .catch(() => setSceneGraphExists(false))
      .finally(() => setLoadingGraph(false));
  }, [selectedId]);

  // Auto-fire extract when scene graph is confirmed absent
  useEffect(() => {
    if (
      sceneGraphExists === false &&
      selectedId &&
      !extracting &&
      autoExtractFiredRef.current !== selectedId
    ) {
      autoExtractFiredRef.current = selectedId;
      handleExtract();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneGraphExists, selectedId]);

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

  const tabFallback = (
    <div className="flex items-center gap-2.5 text-[var(--muted)] text-sm py-10">
      <svg className="animate-spin" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M21 12a9 9 0 1 1-6.22-8.56" />
      </svg>
      Loading…
    </div>
  );

  return (
    <div className="le-fade-up flex flex-col gap-6">
      <PageHeading
        eyebrow="Lab · V2"
        title="Pair-Picker Lab"
        sub="Select a property, extract its scene graph, then label frame pairs in Director's Cut or let the Apprentice handle routine calls."
      />

      {/* Property selector */}
      <Card className="border-[var(--line)] bg-[var(--surface)]">
        <CardContent className="p-5">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm font-semibold text-[var(--ink)] min-w-[80px]">
              Property
            </label>
            {listings === null ? (
              <Skeleton className="h-9 w-60 rounded-lg" />
            ) : (
              <Select
                value={selectedId}
                onValueChange={(val) => {
                  setSelectedId(val);
                  setSceneGraphExists(null);
                }}
              >
                <SelectTrigger className="w-72 border-[var(--line)] bg-[var(--surface)] text-sm">
                  <SelectValue placeholder="Select a listing…" />
                </SelectTrigger>
                <SelectContent>
                  {listings.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs"
              asChild
            >
              <Link to="/dashboard/development/lab/new">+ New property</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {selectedId && (
        <>
          {/* Auto-extract banner — shown while extracting or on error */}
          {(extracting || (sceneGraphExists === false && extractError)) && (
            <div
              className="px-4 py-3 rounded-xl flex items-center gap-3 flex-wrap text-sm text-[var(--ink-2)]"
              style={{
                background: "rgba(42,111,219,0.05)",
                border: "1px solid rgba(42,111,219,0.15)",
              }}
            >
              {extracting ? (
                <>
                  <svg className="animate-spin shrink-0" width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                  </svg>
                  <span className="flex-1">
                    Extracting scene graph for this property — takes ~30 seconds and runs one Gemini call (~$0.05)…
                  </span>
                </>
              ) : extractError ? (
                <>
                  <span className="flex-1 text-[var(--bad)]">{extractError}</span>
                  <button
                    type="button"
                    className="text-xs underline underline-offset-2 text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors"
                    onClick={() => {
                      autoExtractFiredRef.current = "";
                      handleExtract();
                    }}
                  >
                    Retry
                  </button>
                </>
              ) : null}
            </div>
          )}

          {/* Re-extract button — only shown when graph already exists */}
          {sceneGraphExists === true && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                disabled={extracting}
                onClick={handleExtract}
                className="gap-1.5 text-xs rounded-xl"
              >
                {extracting && (
                  <svg className="animate-spin" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                  </svg>
                )}
                Re-extract scene graph
              </Button>
            </div>
          )}

          {/* Mode recommendation banner */}
          {modeMismatch && modeState && (
            <div
              className="px-4 py-3 rounded-xl flex items-center gap-3 flex-wrap text-sm text-[var(--ink-2)]"
              style={{
                background: "rgba(42,111,219,0.06)",
                border: "1px solid rgba(42,111,219,0.18)",
              }}
            >
              <span className="flex-1">
                Apprentice agreement is{" "}
                <strong>{Math.round(modeState.apprentice_agreement_rate * 100)}%</strong> across{" "}
                {modeState.total_labels} labels — recommended mode is{" "}
                <strong>
                  {modeState.recommended_mode === "directors_cut" ? "Director's Cut" : "Apprentice Review"}
                </strong>.
              </span>
              <Button
                size="sm"
                className="text-xs rounded-xl"
                onClick={() => {
                  if (modeState.recommended_mode === "directors_cut" || modeState.recommended_mode === "apprentice_review") {
                    setActiveTab(modeState.recommended_mode);
                  }
                }}
              >
                Switch?
              </Button>
            </div>
          )}

          {/* Tabs — only show after a scene graph exists; observability is always accessible */}
          {sceneGraphExists === true ? (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
              <TabsList className="bg-transparent border-b border-[var(--line)] w-full justify-start rounded-none h-auto p-0 gap-0">
                <TabsTrigger
                  value="directors_cut"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--ink)] data-[state=active]:bg-transparent px-5 py-2.5 text-sm font-medium data-[state=active]:font-semibold text-[var(--muted)] data-[state=active]:text-[var(--ink)]"
                >
                  Director's Cut
                </TabsTrigger>
                <TabsTrigger
                  value="apprentice_review"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--ink)] data-[state=active]:bg-transparent px-5 py-2.5 text-sm font-medium data-[state=active]:font-semibold text-[var(--muted)] data-[state=active]:text-[var(--ink)]"
                >
                  Apprentice Review
                </TabsTrigger>
                <TabsTrigger
                  value="observability"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--ink)] data-[state=active]:bg-transparent px-5 py-2.5 text-sm font-medium data-[state=active]:font-semibold text-[var(--muted)] data-[state=active]:text-[var(--ink)]"
                >
                  Observability
                </TabsTrigger>
              </TabsList>

              <TabsContent value="directors_cut" className="mt-0">
                <Suspense fallback={tabFallback}>
                  <DirectorsCutLab listingId={selectedId} />
                </Suspense>
              </TabsContent>

              <TabsContent value="apprentice_review" className="mt-4">
                <Suspense fallback={tabFallback}>
                  <ApprenticeReview listingId={selectedId} />
                </Suspense>
              </TabsContent>

              <TabsContent value="observability" className="mt-4 max-w-lg">
                <Suspense fallback={tabFallback}>
                  <ObservabilityPanel listingId={selectedId} />
                </Suspense>
              </TabsContent>
            </Tabs>
          ) : extracting ? (
            <div className="flex flex-col gap-3 pt-2">
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
