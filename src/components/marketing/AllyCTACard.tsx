// src/components/marketing/AllyCTACard.tsx
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AllyCTACardProps {
  onGetStarted: () => void;
}

/**
 * Expanded CTA card emitted when Ally returns <ally_cta>get_started.
 * Single primary action: opens the LoginDialog (sign-up tab).
 */
export function AllyCTACard({ onGetStarted }: AllyCTACardProps) {
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-3">
      <p className="text-sm font-medium text-foreground">Ready to get started?</p>
      <Button
        onClick={onGetStarted}
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
      >
        Create my account
        <ArrowRight size={16} className="ml-2" />
      </Button>
    </div>
  );
}
