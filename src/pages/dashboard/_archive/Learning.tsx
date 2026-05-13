import { useEffect, useState, type CSSProperties } from "react";
import { Loader2, AlertTriangle, Star, ChevronDown, ChevronUp } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LearningData, PromptRevision } from "@/lib/types";
import { fetchLearningData, fetchPromptRevisions } from "@/lib/api";
import "@/v2/styles/v2.css";

const EYEBROW: CSSProperties = { fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" };
const PAGE_H1: CSSProperties = { fontFamily: "var(--le-font-sans)", fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 0.98, color: "#fff", margin: 0 };
const SECTION_H3: CSSProperties = { fontFamily: "var(--le-font-sans)", fontSize: 20, fontWeight: 500, letterSpacing: "-0.025em", color: "#fff", margin: 0 };
const MONO_VALUE: CSSProperties = { fontFamily: "var(--le-font-mono)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "#fff" };

const Learning = () => {
  const [learning, setLearning] = useState<LearningData | null>(null);
  const [revisions, setRevisions] = useState<Array<{ prompt_name: string; revisions: PromptRevision[] }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [l, r] = await Promise.all([fetchLearningData(), fetchPromptRevisions()]);
        if (cancelled) return;
        setLearning(l);
        setRevisions(r.prompts);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !learning || !revisions) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24">
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-destructive">{error ?? "Failed to load"}</p>
      </div>
    );
  }

  const renderStars = (r: number) => (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3 w-3 ${n <= r ? "fill-foreground text-foreground" : "text-muted-foreground/30"}`}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );

  return (
    <div className="space-y-16">
      <div>
        <span style={EYEBROW}>— Learning</span>
        <h2 className="mt-3" style={PAGE_H1}>Feedback &amp; prompt changelog</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Every rated scene feeds into the next director run as in-context learning. The changelog tracks how system prompts have evolved.
        </p>
      </div>

      <Tabs defaultValue="feedback">
        <TabsList>
          <TabsTrigger value="feedback">Feedback ({learning.totalRatings})</TabsTrigger>
          <TabsTrigger value="changelog">Prompt changelog</TabsTrigger>
        </TabsList>

        {/* ─── Feedback tab ─── */}
        <TabsContent value="feedback" className="mt-10 space-y-16">
          {/* Summary strip */}
          <div className="grid gap-px border border-border bg-border md:grid-cols-3" style={{ borderRadius: 0 }}>
            <div className="bg-background p-6" style={{ borderRadius: 0 }}>
              <span style={EYEBROW}>Total ratings</span>
              <div className="mt-4" style={MONO_VALUE}>{learning.totalRatings}</div>
            </div>
            <div className="bg-background p-6" style={{ borderRadius: 0 }}>
              <span style={EYEBROW}>Average</span>
              <div className="mt-4" style={MONO_VALUE}>
                {learning.avgAll != null ? `${learning.avgAll} / 5` : "—"}
              </div>
            </div>
            <div className="bg-background p-6" style={{ borderRadius: 0 }}>
              <span style={EYEBROW}>14-day trend</span>
              <div className="tabular mt-4 flex items-end gap-1 text-[10px] text-muted-foreground">
                {learning.trend.length === 0 ? (
                  <span>no data yet</span>
                ) : (
                  learning.trend.map((d) => (
                    <div
                      key={d.day}
                      className="flex flex-col items-center"
                      title={`${d.day}: ${d.avg_rating} (n=${d.count})`}
                    >
                      <div
                        className="w-3 bg-foreground/60"
                        style={{ height: `${Math.max(d.avg_rating * 8, 2)}px` }}
                      />
                      <span className="tabular mt-1 text-[8px]">{d.day.slice(5)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Winners */}
          <section>
            <span style={EYEBROW}>— Top winners</span>
            <h3 className="mt-3" style={SECTION_H3}>What's working</h3>
            {learning.winners.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">No 4–5 star ratings yet.</p>
            ) : (
              <div className="mt-6 space-y-1 border-t border-border">
                {learning.winners.map((w) => (
                  <div key={w.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-6 border-b border-border py-4">
                    <div className="tabular w-24">{renderStars(w.rating)}</div>
                    <div className="min-w-0">
                      <div className="tabular text-[10px] uppercase text-muted-foreground">
                        {w.room_type.replace(/_/g, " ")} · {w.camera_movement.replace(/_/g, " ")} · {w.provider ?? "—"}
                      </div>
                      <p className="mt-1 font-mono text-xs leading-snug">{w.prompt}</p>
                      {w.comment && (
                        <p className="mt-2 text-xs italic text-muted-foreground">"{w.comment}"</p>
                      )}
                      {w.tags && w.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {w.tags.map((t) => (
                            <span key={t} className="label bg-foreground/5 px-2 py-0.5 text-foreground">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {w.clip_url && (
                      <a
                        href={w.clip_url}
                        target="_blank"
                        rel="noreferrer"
                        className="label text-muted-foreground hover:text-foreground"
                      >
                        Watch →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Losers */}
          <section>
            <span style={EYEBROW}>— Top losers</span>
            <h3 className="mt-3" style={SECTION_H3}>What's failing</h3>
            {learning.losers.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">No 1–2 star ratings with comments yet.</p>
            ) : (
              <div className="mt-6 space-y-1 border-t border-border">
                {learning.losers.map((l) => (
                  <div key={l.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-6 border-b border-border py-4">
                    <div className="tabular w-24">{renderStars(l.rating)}</div>
                    <div className="min-w-0">
                      <div className="tabular text-[10px] uppercase text-muted-foreground">
                        {l.room_type.replace(/_/g, " ")} · {l.camera_movement.replace(/_/g, " ")} · {l.provider ?? "—"}
                      </div>
                      <p className="mt-1 font-mono text-xs leading-snug">{l.prompt}</p>
                      {l.comment && (
                        <p className="mt-2 text-xs italic text-destructive">"{l.comment}"</p>
                      )}
                      {l.tags && l.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {l.tags.map((t) => (
                            <span key={t} className="label bg-destructive/10 px-2 py-0.5 text-destructive">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {l.clip_url && (
                      <a
                        href={l.clip_url}
                        target="_blank"
                        rel="noreferrer"
                        className="label text-muted-foreground hover:text-foreground"
                      >
                        Watch →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Combo table */}
          <section>
            <span style={EYEBROW}>— Room + movement</span>
            <h3 className="mt-3" style={SECTION_H3}>Average rating per combo</h3>
            {learning.combos.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">No data yet.</p>
            ) : (
              <div className="mt-6 border-t border-border">
                <div className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-6 border-b border-border py-3">
                  <span className="label text-muted-foreground">Room</span>
                  <span className="label text-muted-foreground">Movement</span>
                  <span className="label text-right text-muted-foreground">Avg</span>
                  <span className="label text-right text-muted-foreground">N</span>
                </div>
                {learning.combos.map((c) => (
                  <div
                    key={`${c.room_type}-${c.camera_movement}`}
                    className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-6 border-b border-border py-3 text-xs"
                  >
                    <span>{c.room_type.replace(/_/g, " ")}</span>
                    <span>{c.camera_movement.replace(/_/g, " ")}</span>
                    <span className={`tabular text-right ${c.avg_rating >= 4 ? "text-accent" : c.avg_rating <= 2 ? "text-destructive" : ""}`}>
                      {c.avg_rating}
                    </span>
                    <span className="tabular text-right text-muted-foreground">{c.count}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Provider breakdown */}
          {learning.providers.length > 0 && (
            <section>
              <span style={EYEBROW}>— By provider</span>
              <h3 className="mt-3" style={SECTION_H3}>Average rating per provider</h3>
              <div className="mt-6 grid gap-px border border-border bg-border md:grid-cols-3" style={{ borderRadius: 0 }}>
                {learning.providers.map((p) => (
                  <div key={p.provider} className="bg-background p-6" style={{ borderRadius: 0 }}>
                    <span style={EYEBROW}>{p.provider}</span>
                    <div className="mt-4" style={MONO_VALUE}>{p.avg_rating} / 5</div>
                    <div className="tabular mt-1 text-[10px] text-muted-foreground">{p.count} ratings</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </TabsContent>

        {/* ─── Changelog tab ─── */}
        <TabsContent value="changelog" className="mt-10 space-y-12">
          {revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No prompt revisions recorded yet. The first pipeline run will snapshot the current prompt versions.
            </p>
          ) : (
            revisions.map((group) => (
              <section key={group.prompt_name}>
                <span style={EYEBROW}>— {group.prompt_name}</span>
                <h3 className="mt-3" style={SECTION_H3}>
                  {group.revisions.length} {group.revisions.length === 1 ? "revision" : "revisions"}
                </h3>
                <div className="mt-6 space-y-1 border-t border-border">
                  {group.revisions.map((rev) => {
                    const key = `${group.prompt_name}-${rev.version}`;
                    const isOpen = expanded[key] ?? false;
                    return (
                      <div key={rev.id} className="border-b border-border">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between py-3 text-left"
                          onClick={() => setExpanded((prev) => ({ ...prev, [key]: !isOpen }))}
                        >
                          <div className="flex items-center gap-4">
                            <span className="tabular text-xs font-semibold">v{rev.version}</span>
                            <span className="tabular text-[10px] uppercase text-muted-foreground">
                              {new Date(rev.created_at).toLocaleString()}
                            </span>
                            {rev.note && (
                              <span className="text-xs italic text-muted-foreground">{rev.note}</span>
                            )}
                          </div>
                          {isOpen ? (
                            <ChevronUp className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          )}
                        </button>
                        {isOpen && (
                          <pre className="mb-4 max-h-[500px] overflow-auto border border-border/50 bg-secondary/30 p-4 text-[11px] font-mono leading-relaxed whitespace-pre-wrap">
                            {rev.body}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Learning;
