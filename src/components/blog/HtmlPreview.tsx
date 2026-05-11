import { useMemo } from "react";

interface Props {
  html: string;
  className?: string;
  style?: React.CSSProperties;
}

export function HtmlPreview({ html, className, style }: Props) {
  const srcDoc = useMemo(() => `<!DOCTYPE html><html><head><base target="_blank" /><style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, system-ui, sans-serif; font-size: 15px; line-height: 1.65; color: #1f2937; padding: 24px; margin: 0; max-width: 720px; margin: 0 auto; }
h1 { font-size: 28px; font-weight: 700; margin: 24px 0 12px; line-height: 1.25; }
h2 { font-size: 22px; font-weight: 700; margin: 24px 0 10px; line-height: 1.3; }
h3 { font-size: 18px; font-weight: 600; margin: 20px 0 8px; line-height: 1.4; }
p { margin: 12px 0; }
table { border-collapse: collapse; margin: 16px 0; width: 100%; font-size: 14px; }
th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; vertical-align: top; }
th { background: #f9fafb; font-weight: 600; }
ul, ol { padding-left: 24px; margin: 12px 0; }
li { margin: 4px 0; }
a { color: #2563eb; text-decoration: underline; text-underline-offset: 2px; }
img { max-width: 100%; height: auto; border-radius: 6px; }
blockquote { border-left: 3px solid #e5e7eb; padding-left: 16px; margin: 16px 0; color: #6b7280; font-style: italic; }
strong { font-weight: 600; }
em { font-style: italic; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
</style></head><body>${html}</body></html>`, [html]);

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox=""
      className={className}
      style={style}
      title="Preview"
    />
  );
}
