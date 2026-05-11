import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExt from "@tiptap/extension-link";
import ImageExt from "@tiptap/extension-image";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Heading2, Heading3, Link2, Image as ImageIcon, List, ListOrdered, Quote, Undo, Redo } from "lucide-react";

interface PostEditorProps {
  value: string;
  onChange: (html: string) => void;
  onInsertImageClick: () => void;
}

export function PostEditor({ value, onChange, onInsertImageClick }: PostEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, LinkExt.configure({ openOnClick: false }), ImageExt],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  if (!editor) return null;

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b p-2">
        <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} icon={Bold} />
        <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} icon={Italic} />
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} icon={Heading2} />
        <ToolbarButton active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} icon={Heading3} />
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} icon={List} />
        <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={ListOrdered} />
        <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} icon={Quote} />
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton active={false} onClick={() => {
          const url = window.prompt("Link URL");
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }} icon={Link2} />
        <ToolbarButton active={false} onClick={onInsertImageClick} icon={ImageIcon} />
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton active={false} onClick={() => editor.chain().focus().undo().run()} icon={Undo} />
        <ToolbarButton active={false} onClick={() => editor.chain().focus().redo().run()} icon={Redo} />
      </div>
      <EditorContent editor={editor} className="prose prose-sm max-w-none p-4 min-h-[300px] focus-within:outline-none" />
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
