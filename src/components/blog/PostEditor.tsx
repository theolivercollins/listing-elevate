import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExt from "@tiptap/extension-link";
import ImageExt from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
// All table extensions come from @tiptap/extension-table — the sub-packages
// (@tiptap/extension-table-row, etc.) are aliases that re-export from here.
// Using named imports avoids "default not exported" rollup errors.
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold, Italic, Underline as UIcon, Heading2, Heading3,
  Link2, Image as ImageIcon, List, ListOrdered, Quote,
  Undo, Redo, Code2, AlignLeft, AlignCenter, AlignRight,
  Table as TableIcon, Eye,
} from "lucide-react";
import { HtmlPreview } from "./HtmlPreview";

export type EditorMode = "rich" | "source" | "preview";

interface PostEditorProps {
  value: string;
  onChange: (html: string) => void;
  onInsertImageClick: () => void;
  mode?: EditorMode;
  onModeChange?: (m: EditorMode) => void;
  minHeight?: number;
}

export function PostEditor({
  value, onChange, onInsertImageClick,
  mode = "rich", onModeChange,
  minHeight = 500,
}: PostEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      LinkExt.configure({ openOnClick: false }),
      ImageExt,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow, TableHeader, TableCell,
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none focus:outline-none" },
    },
  });

  // When the parent flips mode rich→source, sync the latest Tiptap HTML out
  // first; when flipping source→rich, push the textarea value into Tiptap.
  useEffect(() => {
    if (!editor) return;
    if (mode === "rich" && editor.getHTML() !== value) {
      editor.commands.setContent(value, false, { preserveWhitespace: "full" });
    }
  }, [mode, value, editor]);

  if (!editor) return null;

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b p-2">
        {mode === "rich" ? (
          <>
            <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} icon={Bold} />
            <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} icon={Italic} />
            <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} icon={UIcon} />
            <Sep />
            <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} icon={Heading2} />
            <ToolbarButton active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} icon={Heading3} />
            <Sep />
            <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} icon={List} />
            <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={ListOrdered} />
            <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} icon={Quote} />
            <Sep />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().setTextAlign("left").run()} icon={AlignLeft} />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().setTextAlign("center").run()} icon={AlignCenter} />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().setTextAlign("right").run()} icon={AlignRight} />
            <Sep />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} icon={TableIcon} />
            <ToolbarButton active={false} onClick={() => {
              const url = window.prompt("Link URL");
              if (url) editor.chain().focus().setLink({ href: url }).run();
            }} icon={Link2} />
            <ToolbarButton active={false} onClick={onInsertImageClick} icon={ImageIcon} />
            <Sep />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().undo().run()} icon={Undo} />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().redo().run()} icon={Redo} />
          </>
        ) : (
          <span className="px-2 text-xs text-muted-foreground">
            {mode === "source" ? "HTML source" : "Preview (read-only)"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" variant={mode === "rich" ? "secondary" : "ghost"} onClick={() => onModeChange?.("rich")} className="h-7 px-2 text-xs">
            Rich
          </Button>
          <Button type="button" size="sm" variant={mode === "source" ? "secondary" : "ghost"} onClick={() => onModeChange?.("source")} className="h-7 px-2 text-xs">
            <Code2 className="mr-1 h-3.5 w-3.5" /> Source
          </Button>
          <Button type="button" size="sm" variant={mode === "preview" ? "secondary" : "ghost"} onClick={() => onModeChange?.("preview")} className="h-7 px-2 text-xs">
            <Eye className="mr-1 h-3.5 w-3.5" /> Preview
          </Button>
        </div>
      </div>

      {mode === "rich" && (
        <EditorContent
          editor={editor}
          className="p-4 prose prose-sm max-w-none focus-within:outline-none"
          style={{ minHeight }}
        />
      )}
      {mode === "source" && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full resize-y border-0 bg-background p-4 font-mono text-xs leading-relaxed focus:outline-none"
          spellCheck={false}
          style={{ minHeight }}
        />
      )}
      {mode === "preview" && (
        <HtmlPreview html={value} className="block w-full border-0 bg-white" style={{ minHeight, height: minHeight }} />
      )}
    </div>
  );
}

function ToolbarButton({ active, onClick, icon: Icon }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Button type="button" variant={active ? "secondary" : "ghost"} size="sm" onClick={onClick} className="h-7 w-7 p-0">
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}
function Sep() { return <span className="mx-1 h-5 w-px bg-border" />; }
