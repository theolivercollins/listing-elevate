import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Loader2, ArrowLeft, BookOpen } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { listRecipes, updateRecipe, deleteRecipe, type LabRecipe } from "@/lib/recipesApi";
import { DashboardCard } from "@/v2/components/dashboard/DashboardCard";
import { DashboardButton } from "@/v2/components/dashboard/DashboardButton";
import { StatusPill } from "@/v2/components/dashboard/StatusPill";
import { EmptyState } from "@/v2/components/dashboard/EmptyState";
import "@/v2/styles/v2.css";

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------

interface RecipeGroup {
  archetype: string;
  recipes: LabRecipe[];
}

function groupRecipes(recipes: LabRecipe[]): RecipeGroup[] {
  const groups = new Map<string, LabRecipe[]>();
  for (const r of recipes) {
    const key = (r.archetype || r.room_type || "Other").trim() || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return Array.from(groups.entries())
    .map(([archetype, list]) => ({
      archetype,
      recipes: list.slice().sort((a, b) => (b.times_applied ?? 0) - (a.times_applied ?? 0)),
    }))
    .sort((a, b) => a.archetype.localeCompare(b.archetype));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 10;

const PromptLabRecipes = () => {
  const [recipes, setRecipes] = useState<LabRecipe[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

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

  // Reset pagination whenever search changes
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [search]);

  // Derive filtered + grouped set
  const filtered =
    recipes?.filter((r) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        r.archetype?.toLowerCase().includes(q) ||
        r.room_type?.toLowerCase().includes(q) ||
        r.prompt_template?.toLowerCase().includes(q)
      );
    }) ?? [];

  const groupedRecipes = groupRecipes(filtered);
  const totalAfterFilter = groupedRecipes.reduce((acc, g) => acc + g.recipes.length, 0);

  // Build paginated sections
  let rendered = 0;
  const sections: ReactNode[] = [];
  for (const group of groupedRecipes) {
    if (rendered >= visible) break;
    const remainingBudget = visible - rendered;
    const sliced = group.recipes.slice(0, remainingBudget);
    rendered += sliced.length;
    sections.push(
      <section key={group.archetype}>
        <div className="le-eyebrow mb-3" style={{ color: "var(--le-text-muted)" }}>
          {group.archetype}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sliced.map((r) => (
            <RecipeCard
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
      </section>
    );
  }

  const hasMore = visible < totalAfterFilter;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2">
          <Link
            to="/dashboard/dev/prompt-lab"
            style={{ color: "var(--le-text-muted)" }}
            className="hover:opacity-70"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
            Studio / Dev
          </div>
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
          style={{
            borderColor: "var(--le-danger)",
            background: "var(--le-danger-soft)",
            color: "var(--le-danger)",
          }}
        >
          {error}
        </div>
      )}

      {/* Search */}
      {recipes !== null && recipes.length > 0 && (
        <Input
          placeholder="Search recipes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      )}

      {/* Body */}
      {recipes === null ? (
        <div className="py-20 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" style={{ color: "var(--le-text-muted)" }} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title="No recipes yet"
          body="Promote a winning iteration from Prompt Lab to seed the recipe library."
        />
      ) : (
        <div className="flex flex-col gap-8">
          {sections}

          {hasMore && (
            <div className="flex justify-center">
              <DashboardButton
                variant="ghost"
                size="md"
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
              >
                View {Math.min(PAGE_SIZE, totalAfterFilter - visible)} more recipes
              </DashboardButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// RecipeCard
// ---------------------------------------------------------------------------

function RecipeCard({
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
      <DashboardCard padding="md" className="flex flex-col gap-3">
        <div>
          <label className="le-eyebrow block mb-1" style={{ color: "var(--le-text-muted)" }}>
            Archetype
          </label>
          <Input value={archetype} onChange={(e) => setArchetype(e.target.value)} className="mt-0.5" />
        </div>
        <div>
          <label className="le-eyebrow block mb-1" style={{ color: "var(--le-text-muted)" }}>
            Prompt template
          </label>
          <Textarea
            value={tmpl}
            onChange={(e) => setTmpl(e.target.value)}
            className="mt-0.5 min-h-[80px] le-mono text-xs"
          />
        </div>
        <div className="flex justify-end gap-2">
          <DashboardButton variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </DashboardButton>
          <DashboardButton variant="primary" size="sm" onClick={save}>
            Save
          </DashboardButton>
        </div>
      </DashboardCard>
    );
  }

  // Pill label: prefer archetype, fall back to room_type
  const pillLabel = recipe.archetype || recipe.room_type || "—";

  return (
    <DashboardCard padding="md" className="flex flex-col gap-3">
      {/* Top row: pill + times-applied counter */}
      <div className="flex items-center justify-between gap-2">
        <StatusPill tone="muted">{pillLabel}</StatusPill>
        <span className="le-mono text-[11px]" style={{ color: "var(--le-text-muted)" }}>
          {recipe.times_applied}× applied
        </span>
      </div>

      {/* Metadata badges */}
      {(recipe.camera_movement || recipe.provider || recipe.rating_at_promotion) && (
        <div className="flex flex-wrap gap-1.5">
          {recipe.camera_movement && (
            <span
              className="le-badge"
              style={{
                background: "var(--le-accent-soft)",
                color: "var(--le-accent-text)",
                fontSize: 9,
                letterSpacing: "0.18em",
              }}
            >
              {recipe.camera_movement}
            </span>
          )}
          {recipe.provider && (
            <span
              className="le-badge"
              style={{
                background: "var(--le-bg-sunken)",
                color: "var(--le-text-muted)",
                fontSize: 9,
                letterSpacing: "0.18em",
              }}
            >
              {recipe.provider}
            </span>
          )}
          {recipe.rating_at_promotion && (
            <span
              className="le-badge"
              style={{
                background: "var(--le-bg-sunken)",
                color: "var(--le-text-muted)",
                fontSize: 9,
                letterSpacing: "0.18em",
              }}
            >
              promoted at {recipe.rating_at_promotion}★
            </span>
          )}
        </div>
      )}

      {/* Prompt template excerpt — clamped */}
      <p
        className="le-mono text-xs leading-relaxed flex-1"
        style={{
          color: "var(--le-text)",
          display: "-webkit-box",
          WebkitLineClamp: 5,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {recipe.prompt_template}
      </p>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <DashboardButton variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </DashboardButton>
        <DashboardButton variant="destructive" size="sm" onClick={archive}>
          Archive
        </DashboardButton>
      </div>
    </DashboardCard>
  );
}

export default PromptLabRecipes;
