import { useEffect, useState } from "react";
import { LabSubNav } from "@/components/dashboard/LabSubNav";
import { Link } from "react-router-dom";
import { PageHeading, Card } from "@/components/dashboard/primitives";
import { listRecipes, updateRecipe, deleteRecipe, type LabRecipe } from "@/lib/recipesApi";

// ─── shared styles ────────────────────────────────────────────────
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
  fontFamily: "var(--le-font-mono)",
  fontSize: 12,
};

const PromptLabRecipes = () => {
  const [recipes, setRecipes] = useState<LabRecipe[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  async function reload() {
    try {
      const r = await listRecipes();
      setRecipes(r.recipes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      <PageHeading eyebrow="Lab" title="Recipe library" />
      <LabSubNav />

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

      <Card padding={0} style={{ overflow: "hidden" }}>
        {recipes === null ? (
          <div style={{ padding: "64px 0", display: "flex", justifyContent: "center" }}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.22-8.56" />
            </svg>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : recipes.length === 0 ? (
          <div
            style={{
              padding: 48,
              textAlign: "center",
              fontSize: 13,
              color: "var(--muted)",
              border: "1px dashed var(--line)",
              borderRadius: "var(--radius)",
              margin: 20,
            }}
          >
            No recipes yet. Rate a Lab iteration 5 and click "Promote to recipe" on the iteration card.
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
                gap: 16,
                padding: "10px 18px",
                borderBottom: "1px solid var(--line)",
                alignItems: "center",
              }}
            >
              <span className="le-d-label">Archetype / Template</span>
              <span className="le-d-label">Room</span>
              <span className="le-d-label">Movement</span>
              <span className="le-d-label">Applied</span>
              <span className="le-d-label">Actions</span>
            </div>
            {recipes.map((r, i) => (
              <RecipeRow
                key={r.id}
                recipe={r}
                isEditing={editing === r.id}
                isLast={i === recipes.length - 1}
                onEdit={() => setEditing(r.id)}
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  reload();
                }}
                onDeleted={reload}
                inputStyle={INPUT_STYLE}
                textareaStyle={TEXTAREA_STYLE}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

function RecipeRow({
  recipe,
  isEditing,
  isLast,
  onEdit,
  onCancel,
  onSaved,
  onDeleted,
  inputStyle,
  textareaStyle,
}: {
  recipe: LabRecipe;
  isEditing: boolean;
  isLast: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  inputStyle: React.CSSProperties;
  textareaStyle: React.CSSProperties;
}) {
  const [archetype, setArchetype] = useState(recipe.archetype);
  const [tmpl, setTmpl] = useState(recipe.prompt_template);

  async function save() {
    await updateRecipe(recipe.id, { archetype, prompt_template: tmpl });
    onSaved();
  }

  async function archive() {
    await updateRecipe(recipe.id, { status: "archived" });
    onDeleted();
  }

  async function remove() {
    if (!confirm("Permanently delete this recipe?")) return;
    await deleteRecipe(recipe.id);
    onDeleted();
  }

  if (isEditing) {
    return (
      <div
        style={{
          padding: 20,
          borderBottom: isLast ? "none" : "1px solid var(--line-2)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          background: "rgba(11,11,16,0.015)",
        }}
      >
        <div>
          <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 5 }}>Archetype</label>
          <input value={archetype} onChange={(e) => setArchetype(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 5 }}>Prompt template</label>
          <textarea value={tmpl} onChange={(e) => setTmpl(e.target.value)} style={textareaStyle} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="le-btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="le-btn-dark" onClick={save}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "16px 18px",
        borderBottom: isLast ? "none" : "1px solid var(--line-2)",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 16, alignItems: "flex-start" }}>
        {/* Archetype + template */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--le-font-mono)", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{recipe.archetype}</div>
          <p style={{ marginTop: 6, fontFamily: "var(--le-font-mono)", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55, wordBreak: "break-word" }}>
            {recipe.prompt_template}
          </p>
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
            applied {recipe.times_applied}&times;
            {recipe.rating_at_promotion != null && <> &middot; promoted at {recipe.rating_at_promotion}/5</>}
          </div>
        </div>

        {/* Room */}
        <div>
          <span
            style={{
              display: "inline-block",
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(11,11,16,0.05)",
              border: "1px solid var(--line-2)",
              fontFamily: "var(--le-font-mono)",
              fontSize: 10.5,
              color: "var(--ink-2)",
            }}
          >
            {recipe.room_type}
          </span>
        </div>

        {/* Movement */}
        <div>
          <span
            style={{
              display: "inline-block",
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(11,11,16,0.05)",
              border: "1px solid var(--line-2)",
              fontFamily: "var(--le-font-mono)",
              fontSize: 10.5,
              color: "var(--ink-2)",
            }}
          >
            {recipe.camera_movement}
          </span>
          {recipe.provider && (
            <div style={{ marginTop: 4 }}>
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 6px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(42,111,219,0.08)",
                  fontSize: 10.5,
                  color: "var(--accent)",
                }}
              >
                {recipe.provider}
              </span>
            </div>
          )}
        </div>

        {/* Applied count */}
        <div style={{ fontSize: 13, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
          {recipe.times_applied}&times;
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)" }}>
          <button
            type="button"
            onClick={onEdit}
            title="Edit"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={archive}
            title="Archive"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8v13H3V8" />
              <path d="M23 3H1v5h22z" />
              <path d="M10 12h4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={remove}
            title="Delete"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default PromptLabRecipes;
