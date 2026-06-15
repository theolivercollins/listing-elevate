import "@/v2/styles/v2.css";
import { Hero } from "@/v2/components/landing/Hero";
import { Process } from "@/v2/components/landing/Process";
import { MarketComparison } from "@/v2/components/landing/MarketComparison";
import { SelectedWork } from "@/v2/components/landing/SelectedWork";
import { Pricing } from "@/v2/components/landing/Pricing";
import { FounderOffer } from "@/v2/components/landing/FounderOffer";
import { FAQ } from "@/v2/components/landing/FAQ";
import { FinalCTA } from "@/v2/components/landing/FinalCTA";
import { Footer } from "@/v2/components/landing/Footer";
import { MarketingAllyChat } from "@/components/marketing/MarketingAllyChat";

/**
 * Landing — composes the light SaaS surface top-to-bottom.
 *
 * The landing defaults to light mode and follows the global theme toggle:
 * when the user switches themes, ThemeProvider adds/removes `.dark` on
 * <html>, and all `--le-*` tokens re-resolve automatically. There is no
 * `[data-theme="light"]` rule in tokens.css, so a `data-theme="light"`
 * attribute on this element would be inert — it is intentionally omitted.
 *
 * Section order:
 *   1. Hero (contains Nav)
 *   2. Process
 *   3. MarketComparison   (custom)
 *   4. SelectedWork       (custom — SAMPLE badges, no fake addresses)
 *   5. Pricing            (custom — $65)
 *   6. FounderOffer       (custom)
 *   7. FAQ                (custom)
 *   8. FinalCTA           (custom)
 *   9. Footer             (ported)
 */
export default function Landing() {
  const allyEnabled = import.meta.env.VITE_HOMEPAGE_ALLY_ENABLED === "true";

  return (
    <div
      data-testid="v2-landing-root"
      data-v2-root
      className="le-root"
      style={{
        minHeight: "100vh",
        background: "var(--le-bg)",
        position: "relative",
        width: "100%",
        maxWidth: "100vw",
        overflowX: "hidden",
        color: "var(--le-text)",
        fontFamily: "var(--le-font-sans)",
      }}
    >
      <Hero />
      <Process />
      <MarketComparison />
      <SelectedWork />
      <Pricing />
      <FounderOffer />
      <FAQ />
      <FinalCTA />
      <Footer />
      {allyEnabled && <MarketingAllyChat onGetStarted={() => { window.location.href = "/upload"; }} />}
    </div>
  );
}
