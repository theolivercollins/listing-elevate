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
//
// StandardLayout from easy-email-extensions wraps EmailEditor with the
// block-library side panel + attribute panel — without it the canvas
// renders but users have no way to drag blocks in.

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import {
  EmailEditor,
  EmailEditorProvider,
} from "easy-email-editor";
import { StandardLayout } from "easy-email-extensions";
import "easy-email-editor/lib/style.css";
import "easy-email-extensions/lib/style.css";
import "@arco-design/web-react/dist/css/arco.css";
import { AdvancedType, JsonToMjml } from "easy-email-core";
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

// LE brand tokens — keep in sync with lib/blog-engine/ally-email-prompt.ts
const LE_BRAND = {
  navy: "#0A2540",
  orange: "#E97316",
  body: "#333333",
  muted: "#888888",
  surface: "#FFFFFF",
  panel: "#F8F9FA",
  line: "#E5E7EB",
  font: "Helvetica, Arial, sans-serif",
};

const DEFAULT_CATEGORIES = [
  {
    label: "Listing Elevate",
    active: true,
    blocks: [
      {
        title: "LE eyebrow",
        type: AdvancedType.TEXT,
        payload: {
          attributes: {
            "font-family": LE_BRAND.font,
            "font-size": "11px",
            "line-height": "1",
            "font-weight": "600",
            "letter-spacing": "0.12em",
            "text-transform": "uppercase",
            color: LE_BRAND.orange,
            padding: "0px 25px",
          },
          data: { value: { content: "NEW LISTING" } },
        },
      },
      {
        title: "LE headline",
        type: AdvancedType.TEXT,
        payload: {
          attributes: {
            "font-family": LE_BRAND.font,
            "font-size": "28px",
            "line-height": "1.25",
            "font-weight": "700",
            "letter-spacing": "-0.01em",
            color: LE_BRAND.navy,
            padding: "8px 25px 16px 25px",
          },
          data: { value: { content: "Your headline goes here" } },
        },
      },
      {
        title: "LE body text",
        type: AdvancedType.TEXT,
        payload: {
          attributes: {
            "font-family": LE_BRAND.font,
            "font-size": "16px",
            "line-height": "1.6",
            color: LE_BRAND.body,
            padding: "0px 25px 14px 25px",
          },
          data: {
            value: {
              content:
                "Write a short, scannable paragraph here — three sentences max. Keep it warm, specific, and locally grounded.",
            },
          },
        },
      },
      {
        title: "LE primary CTA",
        type: AdvancedType.BUTTON,
        payload: {
          attributes: {
            "font-family": LE_BRAND.font,
            "background-color": LE_BRAND.orange,
            color: LE_BRAND.surface,
            "font-size": "16px",
            "font-weight": "700",
            "border-radius": "6px",
            "inner-padding": "14px 32px",
            padding: "16px 25px",
            href: "#",
          },
          data: { value: { content: "Schedule a private tour" } },
        },
      },
      {
        title: "LE hero image",
        type: AdvancedType.IMAGE,
        payload: {
          attributes: {
            src: "https://placehold.co/1200x600/0A2540/FFFFFF?text=Listing+photo",
            alt: "Listing hero",
            width: "600px",
            padding: "0px",
            "fluid-on-mobile": "true",
          },
        },
      },
      {
        title: "LE divider",
        type: AdvancedType.DIVIDER,
        payload: {
          attributes: {
            "border-color": LE_BRAND.line,
            "border-width": "1px",
            "border-style": "solid",
            padding: "8px 25px",
          },
        },
      },
      {
        title: "LE footer note",
        type: AdvancedType.TEXT,
        payload: {
          attributes: {
            "font-family": LE_BRAND.font,
            "font-size": "12px",
            "line-height": "1.6",
            color: LE_BRAND.muted,
            align: "center",
            "container-background-color": LE_BRAND.panel,
            padding: "20px 25px",
          },
          data: {
            value: {
              content:
                'The Helgemo Team · Punta Gorda, FL<br /><a href="{{UNSUBSCRIBE_URL}}" style="color:#888888;text-decoration:underline;">Unsubscribe</a>',
            },
          },
        },
      },
    ],
  },
  {
    label: "Content",
    blocks: [
      { type: AdvancedType.TEXT },
      { type: AdvancedType.IMAGE },
      { type: AdvancedType.BUTTON },
      { type: AdvancedType.SOCIAL },
      { type: AdvancedType.DIVIDER },
      { type: AdvancedType.SPACER },
      { type: AdvancedType.HERO },
      { type: AdvancedType.WRAPPER },
    ],
  },
  {
    label: "Layout",
    displayType: "column" as const,
    blocks: [
      { title: "1 column", payload: [["100%"]] },
      { title: "2 columns", payload: [["50%", "50%"]] },
      { title: "3 columns", payload: [["33%", "33%", "33%"]] },
      { title: "4 columns", payload: [["25%", "25%", "25%", "25%"]] },
      { title: "2 / 1 (66/33)", payload: [["66%", "33%"]] },
      { title: "1 / 2 (33/66)", payload: [["33%", "66%"]] },
    ],
  },
];

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
          Drag blocks from the left panel · MJML output for cross-client deliverability
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
            return (
              <StandardLayout
                compact={false}
                showSourceCode={false}
                categories={DEFAULT_CATEGORIES}
              >
                <EmailEditor />
              </StandardLayout>
            );
          }}
        </EmailEditorProvider>
      </div>
    </div>
  );
});

export default EmailDesigner;
