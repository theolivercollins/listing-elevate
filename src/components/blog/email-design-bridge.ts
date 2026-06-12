import type { IBlockData } from "easy-email-core";

const ROOT_BLOCK = {
  type: "page",
  attributes: {
    "background-color": "#FFFFFF",
    "padding-left": "0px",
    "padding-right": "0px",
    "padding-top": "0px",
    "padding-bottom": "0px",
    width: "600px",
    "font-family": "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
    "content-background-color": "#FFFFFF",
    "text-color": "#0F172A",
  },
  data: { value: { breakpoint: "480px", "head-attributes": "" } },
};

export function blankPage(): IBlockData {
  return { ...ROOT_BLOCK, children: [] } as unknown as IBlockData;
}

export function isUnlayerShape(design: unknown): boolean {
  if (!design || typeof design !== "object") return false;
  const d = design as Record<string, unknown>;
  if ("type" in d && d.type === "page") return false;
  const body = d.body as Record<string, unknown> | undefined;
  return !!body && "rows" in body;
}

export function bridgeUnlayerDesign(initialHtml: string): IBlockData {
  const safeHtml = (initialHtml ?? "").trim() || "<p>(legacy email body)</p>";
  return {
    ...ROOT_BLOCK,
    children: [
      {
        type: "section",
        attributes: {
          "background-repeat": "repeat",
          "background-size": "auto",
          "background-position": "top center",
          padding: "20px 0px 20px 0px",
          "text-align": "center",
        },
        data: { value: {} },
        children: [
          {
            type: "column",
            attributes: {
              padding: "0px 0px 0px 0px",
              "vertical-align": "top",
            },
            data: { value: {} },
            children: [
              {
                type: "raw",
                attributes: {},
                data: { value: { content: safeHtml } },
                children: [],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as IBlockData;
}
