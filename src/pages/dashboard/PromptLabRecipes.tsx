import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, ArrowLeft, Archive, Trash2, Edit2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { listRecipes, updateRecipe, deleteRecipe, type LabRecipe } from "@/lib/recipesApi";
import "@/v2/styles/v2.css";

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
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2">
          <Link to="/dashboard/dev/prompt-lab" style={{ color: "var(--le-text-muted)" }} className="hover:opacity-70">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Studio / Dev</div>
        </div>
        <h2
          className="le-display mt-1 text-[28px] font-medium tracking-tight"
          style={{ color: "var(--le-text)" }}
        >
          Recipes
        </h2>
        <p className="mt-1.5 text-sm" style={{ color: "var(--le-text-muted)", maxWidth: 520 }}>
          Winners promoted from Prompt Lab. Used as in-context exemplars by the director.
        </p>
      </div>

      {error && (
        <div
          className="rounded-[10px] border p-3 text-sm"
          style={{ borderColor: "var(--le-danger)", background: "var(--le-danger-soft)", color: "var(--le-danger)" }}
        >
          {error}
        </div>
      )}

      {recipes === null ? (
        <div className="py-20 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" style={{ color: "var(--le-text-muted)" }} />
        </div>
      ) : recipes.length === 0 ? (
        <div
          className="rounded-[14px] border border-dashed p-12 text-center text-sm"
          style={{ borderColor: "var(--le-border)", color: "var(--le-text-muted)" }}
        >
          No recipes yet. Rate a Lab iteration 5 and click &quot;Promote to recipe&quot; on the iteration card.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {recipes.map((r) => (
            <RecipeRow
              key={r.id}
              recipe={r}
              isEditing={editing === r.id}
              onEdit={() => setEditing(r.id)}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                reload();
              }}
              onDeleted={reload}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function RecipeRow({
  recipe,
  isEditing,
  onEdit,
  onCancel,
  onSaved,
  onDeleted,
}: {
  recipe: LabRecipe;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
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
        className="le-card rounded-[14px] p-5 flex flex-col gap-3"
        style={{ boxShadow: "var(--le-shadow-sm)" }}
      >
        <div>
          <label className="le-eyebrow block mb-1" style={{ color: "var(--le-text-muted)" }}>Archetype</label>
          <Input value={archetype} onChange={(e) => setArchetype(e.target.value)} className="mt-0.5" />
        </div>
        <div>
          <label className="le-eyebrow block mb-1" style={{ color: "var(--le-text-muted)" }}>Prompt template</label>
          <Textarea value={tmpl} onChange={(e) => setTmpl(e.target.value)} className="mt-0.5 min-h-[80px] le-mono text-xs" />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="le-btn le-btn-ghost text-xs px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="le-btn le-btn-primary text-xs px-3 py-1.5"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="le-card rounded-[14px] p-5"
      style={{ boxShadow: "var(--le-shadow-sm)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="le-mono text-sm font-medium" style={{ color: "var(--le-text)" }}>{recipe.archetype}</span>
            <span
              className="le-badge"
              style={{ background: "var(--le-bg-sunken)", color: "var(--le-text-muted)", fontSize: 9, letterSpacing: "0.18em", borderRadius: 0 }}
            >
              {recipe.room_type}
            </span>
            <span
              className="le-badge"
              style={{ background: "var(--le-accent-soft)", color: "var(--le-accent-text)", fontSize: 9, letterSpacing: "0.18em", borderRadius: 0 }}
            >
              {recipe.camera_movement}
            </span>
            {recipe.provider && (
              <span
                className="le-badge"
                style={{ background: "var(--le-bg-sunken)", color: "var(--le-text-muted)", fontSize: 9, letterSpacing: "0.18em", borderRadius: 0 }}
              >
                {recipe.provider}
              </span>
            )}
            <span className="le-mono text-xs" style={{ color: "var(--le-text-muted)" }}>
              applied {recipe.times_applied}×
              {recipe.rating_at_promotion && <> · promoted at {recipe.rating_at_promotion}★</>}
            </span>
          </div>
          <p className="mt-3 le-mono text-sm leading-relaxed" style={{ color: "var(--le-text)" }}>{recipe.prompt_template}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2" style={{ color: "var(--le-text-muted)" }}>
          <button
            onClick={onEdit}
            title="Edit"
            className="hover:opacity-70 transition-opacity"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={archive}
            title="Archive"
            className="hover:opacity-70 transition-opacity"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={remove}
            title="Delete"
            className="hover:opacity-70 transition-opacity"
            style={{ color: "var(--le-danger)" }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default PromptLabRecipes;
