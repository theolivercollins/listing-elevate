// src/components/blog/EmailDesigner.tsx
//
// Wraps easy-email-editor (Easy Email OSS, MJML output) for use inside
// EmailDetail and EmailTemplateDetail.
//
// Public handle contract is identical to the previous Unlayer wrapper:
//   const designerRef = useRef<EmailDesignerHandle>(null);
//   designerRef.current?.exportHtml((design, html) => { ... });
//
// Internals: Easy Email's <EmailEditorProvider> wraps a final-form managed
// state tree; the FormApi handle is stashed in a ref so exportHtml can read
// the current values, convert IPage → MJML via JsonToMjml, then render to
// inline HTML via mjml-browser.

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import {
  EmailEditor,
  EmailEditorProvider,
} from "easy-email-editor";
import "easy-email-editor/lib/style.css";
import { JsonToMjml } from "easy-email-core";
import type { IBlockData } from "easy-email-core";
import type { FormApi, FormState } from "final-form";
import mjml from "mjml-browser";
import { Button } from "@/components/ui/button";
import { Eye, FlaskConical, Save } from "lucide-react";
import {
  blankPage,
  bridgeUnlayerDesign,
  isUnlayerShape,
} from "@/components/blog/email-design-bridge";

interface IEmailValues {
  content: IBlockData;
  subject: string;
  subTitle: string;
}

export interface EmailDesignerHandle {
  exportHtml: (cb: (design: unknown, html: string) => void) => void;
}

interface Props {
  initialDesign?: unknown;
  initialHtml?: string;
  initialSubject?: string;
  onSave: (design: unknown, html: string) => void;
  onChange?: () => void;
  onTestSend?: () => void;
}

function buildInitialValues(
  initialDesign: unknown,
  initialHtml: string,
  initialSubject: string,
): IEmailValues {
  const content: IBlockData =
    initialDesign && typeof initialDesign === "object" && !isUnlayerShape(initialDesign)
      ? (initialDesign as IBlockData)
      : initialDesign && isUnlayerShape(initialDesign)
        ? bridgeUnlayerDesign(initialHtml)
        : blankPage();

  return {
    content,
    subject: initialSubject,
    subTitle: "",
  };
}

const EmailDesigner = forwardRef<EmailDesignerHandle, Props>(function EmailDesigner(
  { initialDesign, initialHtml, initialSubject = "", onSave, onTestSend },
  ref,
) {
  const formApiRef = useRef<FormApi<IEmailValues> | null>(null);

  const initialValues = useMemo(
    () => buildInitialValues(initialDesign, initialHtml ?? "", initialSubject),
    // Only rebuild when the parent swaps the design entirely (different email/template).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function renderHtml(values: IEmailValues): string {
    try {
      const mjmlString = JsonToMjml({
        data: values.content,
        mode: "production",
        context: values.content,
      });
      const { html } = mjml(mjmlString, { validationLevel: "soft", minify: true });
      return html;
    } catch {
      return "";
    }
  }

  useImperativeHandle(ref, () => ({
    exportHtml(cb) {
      const api = formApiRef.current;
      if (!api) {
        cb({}, "");
        return;
      }
      const values = api.getState().values;
      cb(values, renderHtml(values));
    },
  }));

  function handleSave() {
    const api = formApiRef.current;
    if (!api) return;
    const values = api.getState().values;
    onSave(values, renderHtml(values));
  }

  function handlePreview() {
    const api = formApiRef.current;
    if (!api) return;
    const html = renderHtml(api.getState().values);
    const win = window.open("", "_blank", "width=720,height=900");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }

  return (
    <div className="flex h-full flex-col">
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
          Drag-and-drop builder powered by Easy Email · MJML output
        </span>
      </div>

      <div className="relative flex-1" style={{ minHeight: 600 }}>
        <EmailEditorProvider
          data={initialValues as unknown as IEmailValues}
          height="100%"
          autoComplete
          dashed={false}
        >
          {(_formState: FormState<IEmailValues>, helper: FormApi<IEmailValues>) => {
            formApiRef.current = helper;
            return <EmailEditor />;
          }}
        </EmailEditorProvider>
      </div>
    </div>
  );
});

export default EmailDesigner;
