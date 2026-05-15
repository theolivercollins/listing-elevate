// src/components/marketing/AllyChip.tsx
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface AllyChipProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Quick-reply / suggested-reply pill. Outline style with brand accent
 * border + text, fills on hover.
 */
export function AllyChip({ label, onClick, disabled, className }: AllyChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-background px-3 py-1.5",
        "text-sm font-medium text-accent transition-colors",
        "hover:bg-accent/10 hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        className,
      )}
    >
      <Sparkles size={14} className="opacity-70" />
      <span>{label}</span>
    </button>
  );
}
