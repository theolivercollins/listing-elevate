import { useMemo } from "react";

interface Props {
  html: string;
  className?: string;
  style?: React.CSSProperties;
}

export function HtmlPreview({ html, className, style }: Props) {
  const srcDoc = useMemo(() => `<!DOCTYPE html><html><head><base target="_blank" /><style>
body { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; line-height: 1.5; color: #1f2937; padding: 12px; margin: 0; }
h2 { font-size: 18px; margin: 12px 0 6px; }
h3 { font-size: 15px; margin: 10px 0 5px; }
p { margin: 6px 0; }
table { border-collapse: collapse; margin: 8px 0; width: 100%; }
th, td { border: 1px solid #e5e7eb; padding: 4px 6px; text-align: left; }
th { background: #f3f4f6; }
ul, ol { padding-left: 20px; }
a { color: #2563eb; text-decoration: underline; }
img { max-width: 100%; height: auto; }
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
