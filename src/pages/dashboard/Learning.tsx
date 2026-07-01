import { useEffect, useState } from "react";
import { LabSubNav } from "@/components/dashboard/LabSubNav";
import { Icon } from "@/components/dashboard/icons";
import { PageHeading, KpiCard, Card, SectionTitle } from "@/components/dashboard/primitives";
import type { LearningData, PromptRevision } from "@/lib/types";
import { fetchLearningData, fetchPromptRevisions } from "@/lib/api";

// ─── star row ─────────────────────────────────────────────────────
function StarRow({ value }: { value: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill={n <= value ? "var(--ink)" : "transparent"}
          stroke={n <= value ? "var(--ink)" : "var(--line)"}
          strokeWidth={1.8}
          strokeLinejoin="round"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21l1.18-6.88-5-4.87 6.91-1.01z" />
        </svg>
      ))}
    </span>
  );
}

const Learning = () => {
  const [learning, setLearning] = useState<LearningData | null>(null);
  const [revisions, setRevisions] = useState<Array<{ prompt_name: string; revisions: PromptRevision[] }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"feedback" | "changelog">("feedback");
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
      <div className="le-fade-up" style={{ padding: "80px 0", display: "flex", justifyContent: "center" }}>
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
          <path d="M21 12a9 9 0 1 1-6.22-8.56" />
        </svg>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !learning || !revisions) {
    return (
      <div className="le-fade-up" style={{ padding: "80px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <Icon name="alert" size={20} style={{ color: "var(--bad)" }} />
        <p style={{ fontSize: 13, color: "var(--bad)" }}>{error ?? "Failed to load"}</p>
      </div>
    );
  }

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      <LabSubNav />
      <PageHeading
        eyebrow="Lab"
        title="Learning &amp; changelog"
        sub="Every rated scene feeds into the next director run as in-context learning. The changelog tracks how system prompts have evolved."
      />

      {/* KPI strip */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <KpiCard
          label="Total ratings"
          value={learning.totalRatings}
          sub="all surfaces"
          delta={null}
        />
        <KpiCard
          label="Average rating"
          value={learning.avgAll != null ? `${learning.avgAll} / 5` : "—"}
          sub="all rated scenes"
          delta={null}
        />
        <KpiCard
          label="14-day trend"
          value={learning.trend.length > 0 ? `${learning.trend.length} days` : "no data"}
          sub="daily rating activity"
          delta={null}
        />
      </section>

      {/* Tabs */}
      <div className="le-seg" style={{ alignSelf: "flex-start" }}>
        <button
          type="button"
          className={`le-seg-item${activeTab === "feedback" ? " is-active" : ""}`}
          onClick={() => setActiveTab("feedback")}
        >
          Feedback ({learning.totalRatings})
        </button>
        <button
          type="button"
          className={`le-seg-item${activeTab === "changelog" ? " is-active" : ""}`}
          onClick={() => setActiveTab("changelog")}
        >
          Prompt changelog
        </button>
      </div>

      {/* ─── Feedback tab ─── */}
      {activeTab === "feedback" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* 14-day mini chart */}
          {learning.trend.length > 0 && (
            <Card padding={20}>
              <SectionTitle eyebrow="14-day trend" title="Daily rating activity" />
              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 4,
                  height: 60,
                }}
              >
                {learning.trend.map((d) => (
                  <div
                    key={d.day}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}
                    title={`${d.day}: ${d.avg_rating} (n=${d.count})`}
                  >
                    <div
                      style={{
                        width: "100%",
                        background: "var(--ink)",
                        borderRadius: "var(--radius-sm)",
                        opacity: 0.6,
                        height: `${Math.max(d.avg_rating * 8, 2)}px`,
                      }}
                    />
                    <span style={{ marginTop: 4, fontSize: 8, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                      {d.day.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Winners */}
          <Card padding={24}>
            <SectionTitle eyebrow="Top winners" title="What's working" />
            {learning.winners.length === 0 ? (
              <p style={{ marginTop: 16, fontSize: 13, color: "var(--muted)" }}>No 4–5 star ratings yet.</p>
            ) : (
              <div style={{ marginTop: 16 }}>
                {/* Table header */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "80px 1fr auto",
                    gap: 16,
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--line)",
                    alignItems: "center",
                  }}
                >
                  <span className="le-d-label">Rating</span>
                  <span className="le-d-label">Scene</span>
                  <span className="le-d-label">Clip</span>
                </div>
                {learning.winners.map((w, i) => (
                  <div
                    key={w.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "80px 1fr auto",
                      gap: 16,
                      padding: "14px 14px",
                      borderBottom: i < learning.winners.length - 1 ? "1px solid var(--line-2)" : "none",
                      alignItems: "flex-start",
                    }}
                  >
                    <div><StarRow value={w.rating} /></div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums", marginBottom: 4 }}>
                        {w.room_type.replace(/_/g, " ")} &middot; {w.camera_movement.replace(/_/g, " ")} &middot; {w.provider ?? "—"}
                      </div>
                      <p style={{ fontFamily: "var(--le-font-sans)", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55 }}>{w.prompt}</p>
                      {w.comment && (
                        <p style={{ marginTop: 6, fontSize: 12, fontStyle: "italic", color: "var(--muted)" }}>"{w.comment}"</p>
                      )}
                      {w.tags && w.tags.length > 0 && (
                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {w.tags.map((t) => (
                            <span
                              key={t}
                              style={{
                                padding: "2px 7px",
                                borderRadius: "var(--radius-pill)",
                                background: "rgba(11,11,16,0.05)",
                                fontSize: 10.5,
                                color: "var(--ink-2)",
                              }}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      {w.clip_url ? (
                        <a
                          href={w.clip_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
                        >
                          <Icon name="external" size={12} />
                          Watch
                        </a>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted-2)" }}>—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Losers */}
          <Card padding={24}>
            <SectionTitle eyebrow="Top losers" title="What's failing" />
            {learning.losers.length === 0 ? (
              <p style={{ marginTop: 16, fontSize: 13, color: "var(--muted)" }}>No 1–2 star ratings with comments yet.</p>
            ) : (
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "80px 1fr auto",
                    gap: 16,
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--line)",
                    alignItems: "center",
                  }}
                >
                  <span className="le-d-label">Rating</span>
                  <span className="le-d-label">Scene</span>
                  <span className="le-d-label">Clip</span>
                </div>
                {learning.losers.map((l, i) => (
                  <div
                    key={l.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "80px 1fr auto",
                      gap: 16,
                      padding: "14px 14px",
                      borderBottom: i < learning.losers.length - 1 ? "1px solid var(--line-2)" : "none",
                      alignItems: "flex-start",
                    }}
                  >
                    <div><StarRow value={l.rating} /></div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums", marginBottom: 4 }}>
                        {l.room_type.replace(/_/g, " ")} &middot; {l.camera_movement.replace(/_/g, " ")} &middot; {l.provider ?? "—"}
                      </div>
                      <p style={{ fontFamily: "var(--le-font-sans)", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55 }}>{l.prompt}</p>
                      {l.comment && (
                        <p style={{ marginTop: 6, fontSize: 12, fontStyle: "italic", color: "var(--bad)" }}>"{l.comment}"</p>
                      )}
                      {l.tags && l.tags.length > 0 && (
                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {l.tags.map((t) => (
                            <span
                              key={t}
                              style={{
                                padding: "2px 7px",
                                borderRadius: "var(--radius-pill)",
                                background: "color-mix(in srgb, var(--bad) 8%, transparent)",
                                fontSize: 10.5,
                                color: "var(--bad)",
                              }}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      {l.clip_url ? (
                        <a
                          href={l.clip_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
                        >
                          <Icon name="external" size={12} />
                          Watch
                        </a>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted-2)" }}>—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Combo table */}
          <Card padding={24}>
            <SectionTitle eyebrow="Room + movement" title="Average rating per combo" />
            {learning.combos.length === 0 ? (
              <p style={{ marginTop: 16, fontSize: 13, color: "var(--muted)" }}>No data yet.</p>
            ) : (
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 2fr 1fr 1fr",
                    gap: 16,
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <span className="le-d-label">Room</span>
                  <span className="le-d-label">Movement</span>
                  <span className="le-d-label" style={{ textAlign: "right" }}>Avg</span>
                  <span className="le-d-label" style={{ textAlign: "right" }}>N</span>
                </div>
                {learning.combos.map((c, i) => (
                  <div
                    key={`${c.room_type}-${c.camera_movement}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 2fr 1fr 1fr",
                      gap: 16,
                      padding: "12px 14px",
                      borderBottom: i < learning.combos.length - 1 ? "1px solid var(--line-2)" : "none",
                      fontSize: 12.5,
                      color: "var(--ink-2)",
                    }}
                  >
                    <span>{c.room_type.replace(/_/g, " ")}</span>
                    <span>{c.camera_movement.replace(/_/g, " ")}</span>
                    <span
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        color: c.avg_rating >= 4 ? "var(--good)" : c.avg_rating <= 2 ? "var(--bad)" : "var(--ink-2)",
                        fontWeight: c.avg_rating >= 4 ? 600 : 400,
                      }}
                    >
                      {c.avg_rating}
                    </span>
                    <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{c.count}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Provider breakdown */}
          {learning.providers.length > 0 && (
            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
              {learning.providers.map((p) => (
                <div key={p.provider} className="le-kpi-card">
                  <span className="le-d-label">{p.provider}</span>
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 28,
                      fontWeight: 600,
                      letterSpacing: "-0.025em",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--ink)",
                    }}
                  >
                    {p.avg_rating} / 5
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                    {p.count} ratings
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* ─── Changelog tab ─── */}
      {activeTab === "changelog" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {revisions.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              No prompt revisions recorded yet. The first pipeline run will snapshot the current prompt versions.
            </p>
          ) : (
            revisions.map((group) => (
              <Card key={group.prompt_name} padding={24}>
                <SectionTitle
                  eyebrow={group.prompt_name}
                  title={`${group.revisions.length} ${group.revisions.length === 1 ? "revision" : "revisions"}`}
                />
                <div style={{ marginTop: 16 }}>
                  {group.revisions.map((rev) => {
                    const key = `${group.prompt_name}-${rev.version}`;
                    const isOpen = expanded[key] ?? false;
                    return (
                      <div key={rev.id} style={{ borderBottom: "1px solid var(--line-2)" }}>
                        <button
                          type="button"
                          style={{
                            display: "flex",
                            width: "100%",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "12px 0",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontFamily: "var(--le-font-sans)",
                            textAlign: "left",
                          }}
                          onClick={() => setExpanded((prev) => ({ ...prev, [key]: !isOpen }))}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
                              v{rev.version}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                              {new Date(rev.created_at).toLocaleString()}
                            </span>
                            {rev.note && (
                              <span style={{ fontSize: 12, fontStyle: "italic", color: "var(--muted)" }}>{rev.note}</span>
                            )}
                          </div>
                          <Icon name={isOpen ? "chevron-up" : "chevron-down"} size={12} style={{ color: "var(--muted)", flexShrink: 0 }} />
                        </button>
                        {isOpen && (
                          <pre
                            className="le-card-flat"
                            style={{
                              marginBottom: 14,
                              maxHeight: 500,
                              overflow: "auto",
                              padding: 14,
                              fontSize: 11,
                              fontFamily: "var(--le-font-sans)",
                              lineHeight: 1.65,
                              whiteSpace: "pre-wrap",
                              color: "var(--ink-2)",
                            }}
                          >
                            {rev.body}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default Learning;
