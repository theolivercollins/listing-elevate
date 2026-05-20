// src/components/blog/EmailDesigner.tsx
//
// Wraps react-email-editor (Unlayer) for use inside EmailDetail and
// EmailTemplateDetail. The Unlayer editor loads as an iframe so there are no
// SSR concerns in our Vite + React setup.
//
// Usage:
//   const designerRef = useRef<EmailDesignerHandle>(null);
//   // Later, to export:
//   designerRef.current?.exportHtml((design, html) => { ... });
//
// The component never auto-saves — the parent drives persistence via the
// toolbar buttons (Save, Preview, Test).

import { forwardRef, useImperativeHandle, useRef } from "react";
import EmailEditor from "react-email-editor";
import type { EditorRef } from "react-email-editor";
import { Button } from "@/components/ui/button";
import { Eye, FlaskConical, Save } from "lucide-react";

export interface EmailDesignerHandle {
  exportHtml: (cb: (design: any, html: string) => void) => void;
}

interface Props {
  initialDesign?: any;
  /** Raw HTML string — only used as a visual reference when there is no saved
   *  design_json. Unlayer cannot reliably re-import arbitrary HTML so we always
   *  start with a blank canvas when there is no design_json. */
  initialHtml?: string;
  onSave: (design: any, html: string) => void;
  onChange?: () => void;
  onTestSend?: () => void;
}

const EmailDesigner = forwardRef<EmailDesignerHandle, Props>(function EmailDesigner(
  { initialDesign, onSave, onChange, onTestSend },
  ref,
) {
  const editorRef = useRef<EditorRef>(null);

  useImperativeHandle(ref, () => ({
    exportHtml(cb) {
      editorRef.current?.editor?.exportHtml((data: { design: any; html: string }) => {
        cb(data.design, data.html);
      });
    },
  }));

  function handleLoad() {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    if (initialDesign && typeof initialDesign === "object" && Object.keys(initialDesign).length > 0) {
      editor.loadDesign(initialDesign);
    } else {
      editor.loadBlank({});
    }
    // Notify parent on any design change so it can mark "dirty"
    if (onChange) {
      editor.addEventListener("design:updated", onChange);
    }
  }

  function handleSave() {
    editorRef.current?.editor?.exportHtml((data: { design: any; html: string }) => {
      onSave(data.design, data.html);
    });
  }

  function handlePreview() {
    editorRef.current?.editor?.showPreview({ device: "desktop" });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-4 py-2">
        <Button size="sm" onClick={handleSave}>
          <Save className="mr-1.5 h-3.5 w-3.5" /> Save
        </Button>
        <Button size="sm" variant="outline" onClick={handlePreview}>
          <Eye className="mr-1.5 h-3.5 w-3.5" /> Preview
        </Button>
        {onTestSend && (
          <Button size="sm" variant="outline" onClick={onTestSend}>
            <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Send test
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          Drag-and-drop builder powered by Unlayer
        </span>
      </div>

      {/* Editor iframe — fills all remaining height */}
      <div className="relative flex-1" style={{ minHeight: 600 }}>
        <EmailEditor
          ref={editorRef}
          onLoad={handleLoad}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          minHeight="100%"
        />
      </div>
    </div>
  );
});

export default EmailDesigner;
