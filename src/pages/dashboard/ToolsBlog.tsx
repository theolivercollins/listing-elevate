import { useSearchParams, Link } from "react-router-dom";
import { FileText, Image as ImageIcon, LayoutTemplate, Plus } from "lucide-react";
import BlogPostsList from "./BlogPostsList";
import BlogImageLibrary from "./BlogImageLibrary";
import BlogTemplates from "./BlogTemplates";
import "@/v2/styles/v2.css";

type Tab = "posts" | "images" | "templates";

const TABS: Array<{ id: Tab; label: string; icon: typeof FileText }> = [
  { id: "posts", label: "Posts", icon: FileText },
  { id: "images", label: "Image library", icon: ImageIcon },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
];

function parseTab(raw: string | null): Tab {
  if (raw === "images" || raw === "templates") return raw;
  return "posts";
}

export default function ToolsBlog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = parseTab(searchParams.get("tab"));

  function selectTab(id: Tab) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", id);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Tools</div>
          <h2 className="le-display mt-1 text-[28px] font-medium tracking-tight" style={{ color: "var(--le-text)" }}>
            Blog
          </h2>
        </div>
        <Link
          to="/dashboard/blog/posts/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-sm font-medium"
          style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)" }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New post
        </Link>
      </div>

      <div
        className="flex gap-1 rounded-[10px] border p-1"
        style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)" }}
        role="tablist"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(id)}
              className="inline-flex h-8 items-center gap-2 rounded-[6px] px-3 text-xs font-medium transition-colors"
              style={{
                background: isActive ? "var(--le-accent)" : "transparent",
                color: isActive ? "var(--le-accent-fg)" : "var(--le-text-muted)",
              }}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
              {label}
            </button>
          );
        })}
      </div>

      <div>
        {active === "posts" && <BlogPostsList />}
        {active === "images" && <BlogImageLibrary />}
        {active === "templates" && <BlogTemplates />}
      </div>
    </div>
  );
}
