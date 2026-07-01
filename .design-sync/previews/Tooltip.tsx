import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "reelready";

export const Open = () => (
  <div style={{ padding: 24 }}>
    <TooltipProvider>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <button
            style={{
              padding: "8px 12px",
              border: "1px solid var(--border,#e5e7eb)",
              borderRadius: 8,
              background: "#fff",
            }}
          >
            Turnaround
          </button>
        </TooltipTrigger>
        <TooltipContent>Most videos are delivered within 72 hours.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
);
