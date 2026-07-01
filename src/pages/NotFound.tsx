import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const NotFound = () => {
  const location = useLocation();
  const { theme } = useTheme();
  const logoVariant = theme === "dark" ? "light" : "dark";

  useEffect(() => {
    console.error("404 Error: route not found", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="px-8 py-10 md:px-12">
        <Link to="/" className="inline-flex" aria-label="Listing Elevate — go home">
          <LELogoMark size={44} variant={logoVariant} />
        </Link>
      </div>
      <div className="flex flex-1 flex-col items-start justify-center px-8 md:px-12">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE }}
          className="max-w-2xl"
        >
          <span className="label text-muted-foreground">— Off the map</span>
          <h1
            className="mt-6 font-semibold tracking-[-0.04em] leading-[0.92]"
            style={{ fontSize: "clamp(5rem, 18vw, 14rem)" }}
          >
            404
          </h1>
          <h2 className="display-md mt-8">
            This page
            <br />
            <span className="text-muted-foreground">doesn't exist.</span>
          </h2>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
            The link you followed may be broken, or the page may have been moved. Head back to the home page to keep going.
          </p>
          <Button asChild size="lg" className="mt-12">
            <Link to="/">
              Back to home
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <p className="tabular mt-10 text-[11px] text-muted-foreground/60">
            {location.pathname}
          </p>
        </motion.div>
      </div>
      <div className="border-t border-border px-8 py-8 md:px-12">
        <span className="label text-muted-foreground/60">— Listing Elevate</span>
      </div>
    </div>
  );
};

export default NotFound;
