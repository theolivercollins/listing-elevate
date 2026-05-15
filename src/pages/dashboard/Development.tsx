import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeading, Card, SectionTitle } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import {
  listDevNotes,
  createDevNote,
  updateDevNote,
  deleteDevNote,
  type DevNote,
} from "@/lib/devApi";
import { fetchPromptRevisions } from "@/lib/api";
import type { PromptRevision } from "@/lib/types";

// ─── shared input style ───────────────────────────────────────────
const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line)",
  background: "var(--surface)",
  fontSize: 13,
  fontFamily: "var(--le-font-sans)",
  color: "var(--ink)",
  outline: "none",
  boxSizing: "border-box",
};

const TEXTAREA_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  resize: "vertical" as const,
  minHeight: 80,
  lineHeight: 1.5,
};

const GHOST_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--line)",
  background: "transparent",
  color: "var(--ink-2)",
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
};

// ─── quick-link card ──────────────────────────────────────────────
function QuickLink({
  to,
  icon,
  label,
  description,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      style={{ textDecoration: "none" }}
    >
      <div
        className="le-card le-lift"
        style={{ padding: 20, height: "100%", cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ color: "var(--muted)" }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.01em" }}>{label}</span>
          <Icon name="chevron-right" size={13} style={{ marginLeft: "auto", color: "var(--muted)" }} />
        </div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5, margin: 0 }}>{description}</p>
      </div>
    </Link>
  );
}

// ─── main component ───────────────────────────────────────────────
const Development = () => {
  const [notes, setNotes] = useState<DevNote[] | null>(null);
  const [revisions, setRevisions] = useState<Array<{ prompt_name: string; revisions: PromptRevision[] }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ objective: "", accomplishments: "", session_date: new Date().toISOString().slice(0, 10) });

  async function reload() {
    try {
      const [n, r] = await Promise.all([listDevNotes(), fetchPromptRevisions()]);
      setNotes(n.notes);
      setRevisions(r.prompts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleCreate() {
    if (!draft.objective.trim() && !draft.accomplishments.trim()) return;
    try {
      await createDevNote(draft);
      setDraft({ objective: "", accomplishments: "", session_date: new Date().toISOString().slice(0, 10) });
      setCreating(false);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      <PageHeading
        eyebrow="Lab · Development"
        title="Development"
        sub="Working log of session objectives and outcomes, live prompt changelog, and a running reference for how the pipeline works today."
      />

      {/* Quick links grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        <QuickLink
          to="/dashboard/development/learning"
          icon={<Icon name="sparkles" size={16} />}
          label="Learning"
          description="Aggregated ratings across every run — top winners, top losers, avg rating per (room × camera movement × provider), plus the prompt revision changelog."
        />
        <QuickLink
          to="/dashboard/development/lab"
          icon={<Icon name="beaker" size={16} />}
          label="Prompt Lab"
          description="Upload a batch of photos as a &quot;listing&quot;. Director pairs photos into start+end keyframes, plans scenes with intent tags, and you render/rate each clip."
        />
        <QuickLink
          to="/dashboard/development/proposals"
          icon={<Icon name="branch" size={16} />}
          label="Prompt proposals"
          description="Rule mining across rated Lab iterations. Claude proposes specific edits to the DIRECTOR_SYSTEM grounded in winner/loser patterns. Admin approves per-change."
        />
        <QuickLink
          to="/dashboard/development/knowledge-map"
          icon={<Icon name="grid" size={16} />}
          label="Knowledge map"
          description="Every (room type × camera verb) cell colored by learning state. See at a glance which scenes the machine is great at, okay at, weak at, and untested."
        />
        <QuickLink
          to="/dashboard/development/system-status"
          icon={<Icon name="activity" size={16} />}
          label="System status"
          description="Live view of every API call, per-provider spend, queue depth, budget totals, and automatic regression alerts. Auto-refreshes every 30s."
        />
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(196,74,74,0.3)",
            background: "rgba(196,74,74,0.05)",
            fontSize: 13,
            color: "var(--bad)",
          }}
        >
          {error}
        </div>
      )}

      {/* Session notes */}
      <Card padding={24}>
        <SectionTitle
          eyebrow="Session notes"
          title="Working log"
          meta={
            !creating && (
              <button
                type="button"
                className="le-btn-dark"
                onClick={() => setCreating(true)}
              >
                <Icon name="plus" size={13} />
                New session note
              </button>
            )
          }
        />

        {creating && (
          <div
            className="le-card-flat"
            style={{ marginTop: 20, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}
          >
            <div>
              <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 6 }}>Date</label>
              <input
                type="date"
                value={draft.session_date}
                onChange={(e) => setDraft((d) => ({ ...d, session_date: e.target.value }))}
                style={{ ...INPUT_STYLE, width: "auto" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 6 }}>Objective</label>
              <textarea
                value={draft.objective}
                onChange={(e) => setDraft((d) => ({ ...d, objective: e.target.value }))}
                placeholder="What did we set out to do this session?"
                style={TEXTAREA_STYLE}
              />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 6 }}>What we accomplished</label>
              <textarea
                value={draft.accomplishments}
                onChange={(e) => setDraft((d) => ({ ...d, accomplishments: e.target.value }))}
                placeholder="What actually shipped / changed / decided"
                style={{ ...TEXTAREA_STYLE, minHeight: 120 }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                style={GHOST_BTN}
                onClick={() => {
                  setCreating(false);
                  setDraft({ objective: "", accomplishments: "", session_date: new Date().toISOString().slice(0, 10) });
                }}
              >
                Cancel
              </button>
              <button type="button" className="le-btn-dark" onClick={handleCreate}>
                Save note
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          {notes === null ? (
            <div style={{ padding: "40px 0", display: "flex", justifyContent: "center" }}>
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
              </svg>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : notes.length === 0 ? (
            <div
              style={{
                border: "1px dashed var(--line)",
                borderRadius: "var(--radius)",
                padding: 32,
                textAlign: "center",
                fontSize: 13,
                color: "var(--muted)",
              }}
            >
              No session notes yet. Click "New session note" to log what you worked on today.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {notes.map((n) => (
                <NoteRow key={n.id} note={n} onUpdated={reload} />
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Prompt changelog */}
      <Card padding={24}>
        <SectionTitle
          eyebrow="Prompt changelog"
          title="Director + analyzer prompt versions"
        />
        <p style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)" }}>
          Every pipeline run hashes each system prompt and records a revision if the body changed. Full list with expandable bodies lives under{" "}
          <Link to="/dashboard/development/learning" style={{ color: "var(--accent)" }}>Learning &rarr; Changelog</Link>.
        </p>
        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {revisions === null ? (
            <div style={{ gridColumn: "1 / -1", padding: "40px 0", display: "flex", justifyContent: "center" }}>
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
              </svg>
            </div>
          ) : (
            revisions.map((p) => {
              const latest = p.revisions[0];
              return (
                <div
                  key={p.prompt_name}
                  className="le-card-flat"
                  style={{ padding: "12px 14px" }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 12, fontWeight: 500, color: "var(--ink)" }}>{p.prompt_name}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>v{latest?.version ?? "—"}</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--muted)" }}>
                    {p.revisions.length} revision{p.revisions.length === 1 ? "" : "s"}
                    {latest && <> · last {new Date(latest.created_at).toLocaleDateString()}</>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* How it works */}
      <Card padding={24}>
        <SectionTitle eyebrow="How the product works" title="Pipeline + schema reference" />

        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="le-card-flat" style={{ padding: 20 }}>
            <span className="le-d-label">Pipeline (6 stages, fire-and-forget)</span>
            <ol style={{ marginTop: 12, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["1. Intake", <>agent uploads 10–60 photos; <code style={{ fontSize: 11, fontFamily: "var(--le-font-mono)", background: "rgba(11,11,16,0.05)", padding: "1px 5px", borderRadius: 4 }}>POST /api/pipeline/:propertyId</code> fires the run.</>],
                ["2. Analysis", "Claude vision per photo: room, quality/aesthetic, depth, video_viable, key_features, composition, suggested_motion."],
                ["3. Style guide", <>one extra vision pass across all selected photos; stored on <code style={{ fontSize: 11, fontFamily: "var(--le-font-mono)", background: "rgba(11,11,16,0.05)", padding: "1px 5px", borderRadius: 4 }}>properties.style_guide</code> but NOT injected into the director.</>],
                ["4. Scripting", "director picks 10–16 scenes from viable photos. PAST GENERATIONS (rated winners + losers from last 30d) appended as in-context learning."],
                ["5. Generation (submit-only)", "parallel worker pool submits to Kling/Runway, persists task_id, exits. No polling in the pipeline function."],
                ["6. Cron finalize", <><code style={{ fontSize: 11, fontFamily: "var(--le-font-mono)", background: "rgba(11,11,16,0.05)", padding: "1px 5px", borderRadius: 4 }}>/api/cron/poll-scenes</code> every minute: downloads completed clips, records cost, flips property to complete. Shotstack assembly runs here if <code style={{ fontSize: 11, fontFamily: "var(--le-font-mono)", background: "rgba(11,11,16,0.05)", padding: "1px 5px", borderRadius: 4 }}>SHOTSTACK_API_KEY</code> is set.</>],
              ].map(([label, desc], idx) => (
                <li key={idx} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, fontSize: 13, color: "var(--ink-2)" }}>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{label}</span>
                  <span style={{ lineHeight: 1.5 }}>{desc}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="le-card-flat" style={{ padding: 20 }}>
            <span className="le-d-label">Provider routing</span>
            <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
              Movement-first, room-type as tiebreaker. See <code style={{ fontSize: 11, fontFamily: "var(--le-font-mono)", background: "rgba(11,11,16,0.05)", padding: "1px 5px", borderRadius: 4 }}>lib/providers/router.ts</code>.
            </p>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                "push_in / pull_out / drone_* / top_down / feature_closeup → Runway",
                "orbit (interior) → Kling · orbit (exterior/aerial) → Runway",
                "dolly_* / parallax / reveal / low_angle_glide → Kling",
              ].map((line) => (
                <div key={line} style={{ fontFamily: "var(--le-font-mono)", fontSize: 11.5, color: "var(--ink-2)", padding: "4px 0", borderBottom: "1px solid var(--line-2)" }}>{line}</div>
              ))}
            </div>
          </div>

          <div className="le-card-flat" style={{ padding: 20 }}>
            <span className="le-d-label">Camera vocabulary (11 active verbs)</span>
            <div style={{ marginTop: 8, fontFamily: "var(--le-font-mono)", fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
              push_in · pull_out · orbit · parallax · dolly_left_to_right · dolly_right_to_left · reveal · drone_push_in · drone_pull_back · top_down · low_angle_glide · feature_closeup
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              Banned (not emitted by new runs): tilt_up, tilt_down, crane_up, crane_down, slow_pan, orbital_slow. Vertical-only motions don't map to real-estate shot types.
            </div>
          </div>

          <div className="le-card-flat" style={{ padding: 20 }}>
            <span className="le-d-label">Key tables</span>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                ["properties", "address, price, status, cost, horizontal/vertical video urls, style_guide jsonb, pipeline_started_at"],
                ["photos", "room_type, quality/aesthetic, depth_rating, key_features[], composition, video_viable, suggested_motion"],
                ["scenes", "prompt, camera_movement, provider, provider_task_id, clip_url, status"],
                ["scene_ratings", "rating 1–5, comment, tags[], rated_by"],
                ["prompt_revisions", "prompt_name, version, body, body_hash"],
                ["cost_events", "stage, provider, units, cost_cents, metadata"],
                ["prompt_lab_sessions / prompt_lab_iterations", "calibration loop data"],
                ["dev_session_notes", "this page"],
              ].map(([table, desc]) => (
                <div key={table} style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, fontSize: 12, borderBottom: "1px solid var(--line-2)", paddingBottom: 5 }}>
                  <span style={{ fontFamily: "var(--le-font-mono)", color: "var(--muted)", fontWeight: 500 }}>{table}</span>
                  <span style={{ color: "var(--ink-2)" }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

// ── One note row (inline edit + delete) ──

function NoteRow({ note, onUpdated }: { note: DevNote; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    session_date: note.session_date,
    objective: note.objective ?? "",
    accomplishments: note.accomplishments ?? "",
  });

  const INPUT_STYLE: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--line)",
    background: "var(--surface)",
    fontSize: 13,
    fontFamily: "var(--le-font-sans)",
    color: "var(--ink)",
    outline: "none",
    boxSizing: "border-box",
  };

  const TEXTAREA_STYLE_LOCAL: React.CSSProperties = {
    ...INPUT_STYLE,
    resize: "vertical" as const,
    minHeight: 80,
    lineHeight: 1.5,
  };

  async function save() {
    await updateDevNote(note.id, draft);
    setEditing(false);
    onUpdated();
  }

  async function remove() {
    if (!confirm("Delete this session note?")) return;
    await deleteDevNote(note.id);
    onUpdated();
  }

  if (editing) {
    return (
      <div className="le-card-flat" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="date"
          value={draft.session_date}
          onChange={(e) => setDraft((d) => ({ ...d, session_date: e.target.value }))}
          style={{ ...INPUT_STYLE, width: "auto" }}
        />
        <textarea
          value={draft.objective}
          onChange={(e) => setDraft((d) => ({ ...d, objective: e.target.value }))}
          placeholder="Objective"
          style={TEXTAREA_STYLE_LOCAL}
        />
        <textarea
          value={draft.accomplishments}
          onChange={(e) => setDraft((d) => ({ ...d, accomplishments: e.target.value }))}
          placeholder="Accomplishments"
          style={{ ...TEXTAREA_STYLE_LOCAL, minHeight: 100 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            className="le-btn-ghost"
            onClick={() => {
              setEditing(false);
              setDraft({ session_date: note.session_date, objective: note.objective ?? "", accomplishments: note.accomplishments ?? "" });
            }}
          >
            Cancel
          </button>
          <button type="button" className="le-btn-dark" onClick={save}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div className="le-card-flat" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
          {new Date(note.session_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "var(--muted)" }}>
          <button type="button" onClick={() => setEditing(true)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--muted)", fontFamily: "var(--le-font-sans)" }}>
            Edit
          </button>
          <button type="button" onClick={remove} style={{ background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted)", fontFamily: "var(--le-font-sans)" }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            </svg>
            Delete
          </button>
        </div>
      </div>
      {note.objective && (
        <div style={{ marginTop: 10 }}>
          <div className="le-d-label">Objective</div>
          <p style={{ marginTop: 4, fontSize: 13, color: "var(--ink-2)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{note.objective}</p>
        </div>
      )}
      {note.accomplishments && (
        <div style={{ marginTop: 10 }}>
          <div className="le-d-label">Accomplished</div>
          <p style={{ marginTop: 4, fontSize: 13, color: "var(--ink-2)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{note.accomplishments}</p>
        </div>
      )}
    </div>
  );
}

export default Development;
