import type { ReactNode } from 'react';

/**
 * StudioShell
 * Wraps every Studio page body in the .studio-scope class so that the
 * "Apple-clean × Noteflow-soft" design tokens apply only inside Studio.
 *
 * Renders the fixed warm-gray radial-gradient canvas (.studio-bg-base)
 * and the SVG grain texture (.studio-grain) at z-index 0 behind content.
 * The main padding area sits at z-index 2.
 */
export function StudioShell({ children }: { children: ReactNode }) {
  return (
    <div className="studio-scope">
      {/* Fixed warm-paper canvas */}
      <div className="studio-bg-base" aria-hidden="true" />
      {/* Fixed grain texture */}
      <div className="studio-grain" aria-hidden="true" />
      {/* Page content */}
      <div className="studio-main studio-fade-up">
        {children}
      </div>
    </div>
  );
}
