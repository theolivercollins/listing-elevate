import { useEffect, useRef } from "react";
import { Editor as TinyMCEEditor } from "@tinymce/tinymce-react";
import { Button } from "@/components/ui/button";
import { Code2, Eye } from "lucide-react";
import { HtmlPreview } from "./HtmlPreview";

export type EditorMode = "rich" | "source" | "preview";

interface PostEditorProps {
  value: string;
  onChange: (html: string) => void;
  onInsertImageClick?: () => void;
  mode?: EditorMode;
  onModeChange?: (m: EditorMode) => void;
  minHeight?: number;
}

// Pin a specific TinyMCE version on jsDelivr. Self-hosted bundle = no API key
// needed and no "domain not registered" notice. Sierra uses TinyMCE 8 too
// (`res/tinymce8/tinymce.min.js`), so this matches their renderer.
const TINYMCE_SCRIPT_SRC = "https://cdn.jsdelivr.net/npm/tinymce@7.6.1/tinymce.min.js";

export function PostEditor({
  value, onChange, onInsertImageClick,
  mode = "rich", onModeChange,
  minHeight = 500,
}: PostEditorProps) {
  const editorRef = useRef<any>(null);

  // When the parent flips from source/preview back into rich mode, push the
  // textarea/source value into TinyMCE. TinyMCE manages its own buffer once
  // editing starts, but we want it to pick up external edits cleanly.
  useEffect(() => {
    if (mode !== "rich") return;
    const ed = editorRef.current;
    if (ed && typeof ed.getContent === "function" && ed.getContent() !== value) {
      ed.setContent(value);
    }
  }, [mode, value]);

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b p-2">
        {mode !== "rich" && (
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

      {/* TinyMCE is always mounted so its editor state survives mode toggles.
          Hidden via inline style when not in rich mode rather than unmounted. */}
      <div style={{ display: mode === "rich" ? "block" : "none" }}>
        <TinyMCEEditor
          tinymceScriptSrc={TINYMCE_SCRIPT_SRC}
          licenseKey="gpl"
          onInit={(_evt, ed) => { editorRef.current = ed; }}
          value={value}
          onEditorChange={(html) => onChange(html)}
          init={{
            height: minHeight,
            menubar: false,
            branding: false,
            promotion: false,
            statusbar: true,
            plugins: [
              "advlist", "autolink", "lists", "link", "image", "charmap",
              "anchor", "searchreplace", "code", "fullscreen", "media",
              "table", "wordcount", "preview", "visualblocks",
            ],
            toolbar:
              "undo redo | blocks | bold italic underline | " +
              "alignleft aligncenter alignright | bullist numlist outdent indent | " +
              "link image table | code preview fullscreen",
            block_formats: "Paragraph=p; Heading 2=h2; Heading 3=h3; Heading 4=h4; Blockquote=blockquote",
            content_style: `
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; font-size: 15px; line-height: 1.65; color: #1f2937; padding: 16px; max-width: 720px; margin: 0 auto; }
              h2 { font-size: 22px; font-weight: 700; margin: 24px 0 10px; }
              h3 { font-size: 18px; font-weight: 600; margin: 20px 0 8px; }
              p { margin: 12px 0; }
              table { border-collapse: collapse; width: 100%; margin: 16px 0; }
              th, td { border: 1px solid #e5e7eb; padding: 8px 12px; }
              th { background: #f9fafb; font-weight: 600; }
              ul, ol { padding-left: 24px; margin: 12px 0; }
              blockquote { border-left: 3px solid #e5e7eb; padding-left: 16px; color: #6b7280; font-style: italic; }
              img { max-width: 100%; height: auto; }
            `,
            file_picker_types: "image",
            file_picker_callback: onInsertImageClick
              ? (_callback, _value, meta) => {
                  if (meta.filetype === "image") onInsertImageClick();
                }
              : undefined,
            // Keep TinyMCE conservative: no relative URLs, no auto-cleanup that strips inline styles.
            convert_urls: false,
            element_format: "html",
            entity_encoding: "raw",
          }}
        />
      </div>
      {mode === "source" && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full resize-y border-0 bg-background p-4 font-sans text-xs leading-relaxed focus:outline-none"
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
