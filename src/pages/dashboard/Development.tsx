import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { DashboardButton } from "@/v2/components/dashboard/DashboardButton";
import {
  listDevNotes,
  createDevNote,
  updateDevNote,
  deleteDevNote,
  type DevNote,
} from "@/lib/devApi";
import { fetchPromptRevisions } from "@/lib/api";
import type { PromptRevision } from "@/lib/types";
import "@/v2/styles/v2.css";

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

  // Most recent 5 revisions per prompt group (latest revision per prompt),
  // sorted by most-recently-created first.
  const recentRevisions = revisions
    ? revisions
        .map((p) => ({ prompt_name: p.prompt_name, latest: p.revisions[0] ?? null, total: p.revisions.length }))
        .filter((p) => p.latest !== null)
        .sort((a, b) => new Date(b.latest!.created_at).getTime() - new Date(a.latest!.created_at).getTime())
        .slice(0, 5)
    : null;

  return (
    <div className="le-root" style={{ padding: "0", background: "transparent" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>

        {/* Page header */}
        <div>
          <div className="le-eyebrow" style={{ marginBottom: 10 }}>Studio</div>
          <h1
            className="le-display"
            style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 500, color: "var(--le-text)", margin: 0 }}
          >
            Development
          </h1>
        </div>

        {error && (
          <div
            style={{
              padding: "12px 16px",
              background: "var(--le-danger-soft)",
              border: "1px solid var(--le-danger)",
              borderRadius: "var(--le-r-md)",
              color: "var(--le-danger)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {/* Section 1: Session notes */}
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <div className="le-eyebrow" style={{ marginBottom: 6 }}>Working log</div>
              <h2
                className="le-display"
                style={{ fontSize: 20, fontWeight: 500, color: "var(--le-text)", margin: 0 }}
              >
                Session notes
              </h2>
            </div>
            {!creating && (
              <DashboardButton
                variant="ghost"
                size="sm"
                onClick={() => setCreating(true)}
                leftIcon={<Plus style={{ width: 13, height: 13 }} />}
              >
                New note
              </DashboardButton>
            )}
          </div>

          {/* New note form */}
          {creating && (
            <div
              className="le-card"
              style={{ padding: 24, marginBottom: 16, display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div>
                <label style={{ fontSize: 11, color: "var(--le-text-muted)", display: "block", marginBottom: 6 }}>
                  Date
                </label>
                <Input
                  type="date"
                  value={draft.session_date}
                  onChange={(e) => setDraft((d) => ({ ...d, session_date: e.target.value }))}
                  style={{ width: "auto" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--le-text-muted)", display: "block", marginBottom: 6 }}>
                  Objective
                </label>
                <Textarea
                  value={draft.objective}
                  onChange={(e) => setDraft((d) => ({ ...d, objective: e.target.value }))}
                  placeholder="What did we set out to do this session?"
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--le-text-muted)", display: "block", marginBottom: 6 }}>
                  What we accomplished
                </label>
                <Textarea
                  value={draft.accomplishments}
                  onChange={(e) => setDraft((d) => ({ ...d, accomplishments: e.target.value }))}
                  placeholder="What actually shipped / changed / decided"
                  style={{ minHeight: 120 }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCreating(false);
                    setDraft({ objective: "", accomplishments: "", session_date: new Date().toISOString().slice(0, 10) });
                  }}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleCreate}>Save note</Button>
              </div>
            </div>
          )}

          {/* Notes list */}
          {notes === null ? (
            <div style={{ padding: "40px 0", textAlign: "center" }}>
              <Loader2 style={{ width: 20, height: 20, margin: "0 auto", color: "var(--le-text-muted)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : notes.length === 0 ? (
            <div
              style={{
                border: "1px dashed var(--le-border-strong)",
                borderRadius: "var(--le-r-lg)",
                padding: "32px 24px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--le-text-muted)",
              }}
            >
              No session notes yet. Click &quot;New note&quot; to log what you worked on today.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {notes.map((n) => (
                <NoteRow key={n.id} note={n} onUpdated={reload} />
              ))}
            </div>
          )}
        </section>

        {/* Section 2: Prompt revision changelog */}
        <section>
          <div style={{ marginBottom: 20 }}>
            <div className="le-eyebrow" style={{ marginBottom: 6 }}>Recent prompt revisions</div>
            <h2
              className="le-display"
              style={{ fontSize: 20, fontWeight: 500, color: "var(--le-text)", margin: 0 }}
            >
              Prompt changelog
            </h2>
          </div>

          {recentRevisions === null ? (
            <div style={{ padding: "40px 0", textAlign: "center" }}>
              <Loader2 style={{ width: 20, height: 20, margin: "0 auto", color: "var(--le-text-muted)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : recentRevisions.length === 0 ? (
            <div
              style={{
                border: "1px dashed var(--le-border-strong)",
                borderRadius: "var(--le-r-lg)",
                padding: "32px 24px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--le-text-muted)",
              }}
            >
              No prompt revisions recorded yet.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 10,
              }}
            >
              {recentRevisions.map(({ prompt_name, latest, total }) => (
                <div
                  key={prompt_name}
                  className="le-card"
                  style={{ padding: "16px 18px" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <span
                      className="le-mono"
                      style={{ fontSize: 12, fontWeight: 500, color: "var(--le-text)" }}
                    >
                      {prompt_name}
                    </span>
                    <span
                      className="le-mono"
                      style={{
                        fontSize: 11,
                        color: "var(--le-text-muted)",
                        background: "var(--le-bg-sunken)",
                        padding: "1px 7px",
                        borderRadius: 999,
                      }}
                    >
                      v{latest!.version}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--le-text-muted)", marginBottom: 4 }}>
                    {total} revision{total === 1 ? "" : "s"}
                  </div>
                  {latest!.note && (
                    <div style={{ fontSize: 11, color: "var(--le-text-muted)", marginBottom: 4 }}>
                      {latest!.note}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "var(--le-text-faint)", textAlign: "right" }}>
                    {new Date(latest!.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
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
      <div
        className="le-card"
        style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <Input
          type="date"
          value={draft.session_date}
          onChange={(e) => setDraft((d) => ({ ...d, session_date: e.target.value }))}
          style={{ width: "auto" }}
        />
        <Textarea
          value={draft.objective}
          onChange={(e) => setDraft((d) => ({ ...d, objective: e.target.value }))}
          placeholder="Objective"
        />
        <Textarea
          value={draft.accomplishments}
          onChange={(e) => setDraft((d) => ({ ...d, accomplishments: e.target.value }))}
          placeholder="Accomplishments"
          style={{ minHeight: 100 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(false);
              setDraft({
                session_date: note.session_date,
                objective: note.objective ?? "",
                accomplishments: note.accomplishments ?? "",
              });
            }}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save}>Save</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="le-card" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <span
          className="le-mono"
          style={{ fontSize: 11, color: "var(--le-text-muted)", fontVariantNumeric: "tabular-nums" }}
        >
          {new Date(note.session_date + "T00:00:00").toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <DashboardButton
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
          >
            Edit
          </DashboardButton>
          <DashboardButton
            variant="ghost"
            size="sm"
            onClick={remove}
            leftIcon={<Trash2 style={{ width: 12, height: 12 }} />}
            style={{ color: "var(--le-danger)", borderColor: "var(--le-danger)" }}
          >
            Delete
          </DashboardButton>
        </div>
      </div>
      {note.objective && (
        <div style={{ marginTop: 12 }}>
          <div
            className="le-eyebrow"
            style={{ fontSize: 9, marginBottom: 4 }}
          >
            Objective
          </div>
          <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", color: "var(--le-text)" }}>
            {note.objective}
          </p>
        </div>
      )}
      {note.accomplishments && (
        <div style={{ marginTop: 12 }}>
          <div
            className="le-eyebrow"
            style={{ fontSize: 9, marginBottom: 4 }}
          >
            Accomplished
          </div>
          <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", color: "var(--le-text)" }}>
            {note.accomplishments}
          </p>
        </div>
      )}
    </div>
  );
}

export default Development;
