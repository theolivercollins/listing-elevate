import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, ArrowUpRight, Mail, Loader2, CheckCircle, Plus, Minus, Sun, Moon } from "lucide-react";
import { motion, useScroll, useTransform, type Variants } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { supabase, AUTH_CALLBACK_URL } from "@/lib/supabase";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";
import heroVideo from "@/assets/hero-video-loop.mp4.asset.json";
import heroBg from "@/assets/hero-bg.jpg";
import interior1 from "@/assets/interior-1.jpg";
import exterior1 from "@/assets/exterior-1.jpg";
import kitchen1 from "@/assets/kitchen-1.jpg";
import bathroom1 from "@/assets/bathroom-1.jpg";
import aerial1 from "@/assets/aerial-1.jpg";
import showcaseInterior from "@/assets/showcase-interior.mp4.asset.json";
import showcaseKitchen from "@/assets/showcase-kitchen.mp4.asset.json";
import showcaseBathroom from "@/assets/showcase-bathroom.mp4.asset.json";
import showcaseAerial from "@/assets/showcase-aerial.mp4.asset.json";
import showcaseExterior from "@/assets/showcase-exterior.mp4.asset.json";
import showcaseBeach from "@/assets/showcase-beach.mp4.asset.json";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 1.1, delay: i * 0.08, ease: EASE },
  }),
};

const stagger: Variants = {
  visible: { transition: { staggerChildren: 0.12 } },
};

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group flex w-full items-center justify-between py-7 text-left"
      >
        <span className="pr-8 text-base font-semibold tracking-[-0.01em] text-foreground md:text-lg">
          {question}
        </span>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border text-muted-foreground transition-all duration-500 ease-cinematic group-hover:border-foreground group-hover:text-foreground">
          {open ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </div>
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="overflow-hidden"
      >
        <p className="max-w-2xl pb-7 text-sm leading-relaxed text-muted-foreground">
          {answer}
        </p>
      </motion.div>
    </div>
  );
}

const Index = () => {
  const { user, profile } = useAuth();
  const accountHref = profile?.role === "admin" ? "/dashboard" : "/account";
  const accountLabel = profile?.role === "admin" ? "Dashboard" : "Account";
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const heroRef = useRef<HTMLElement>(null);

  // Hero verb typewriter — types Take, holds, deletes, then Retain, then Sell, looping.
  const heroVerbs = ["Take", "Retain", "Sell"] as const;
  const [heroVerbIndex, setHeroVerbIndex] = useState(0);
  const [heroText, setHeroText] = useState("");
  const [heroPhase, setHeroPhase] = useState<"type" | "hold" | "erase" | "rest">("type");

  useEffect(() => {
    const verb = heroVerbs[heroVerbIndex];
    let timeout: ReturnType<typeof setTimeout>;
    const TYPE_MS = 95;
    const ERASE_MS = 55;
    const HOLD_MS = 1600;
    const REST_MS = 380;

    if (heroPhase === "type") {
      if (heroText.length < verb.length) {
        timeout = setTimeout(() => setHeroText(verb.slice(0, heroText.length + 1)), TYPE_MS);
      } else {
        timeout = setTimeout(() => setHeroPhase("hold"), 0);
      }
    } else if (heroPhase === "hold") {
      timeout = setTimeout(() => setHeroPhase("erase"), HOLD_MS);
    } else if (heroPhase === "erase") {
      if (heroText.length > 0) {
        timeout = setTimeout(() => setHeroText(heroText.slice(0, -1)), ERASE_MS);
      } else {
        timeout = setTimeout(() => setHeroPhase("rest"), 0);
      }
    } else if (heroPhase === "rest") {
      timeout = setTimeout(() => {
        setHeroVerbIndex((i) => (i + 1) % heroVerbs.length);
        setHeroPhase("type");
      }, REST_MS);
    }

    return () => clearTimeout(timeout);
  }, [heroText, heroVerbIndex, heroPhase]);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroScale = useTransform(scrollYProgress, [0, 1], [1, 1.08]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.9], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 120]);

  // Auth modal
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authFirst, setAuthFirst] = useState("");
  const [authLast, setAuthLast] = useState("");
  const [authBrokerage, setAuthBrokerage] = useState("");
  const [authSent, setAuthSent] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const openAuth = (tab: "signin" | "signup") => {
    setAuthTab(tab);
    setAuthEmail("");
    setAuthPassword("");
    setAuthFirst("");
    setAuthLast("");
    setAuthBrokerage("");
    setAuthSent(false);
    setAuthError("");
    setAuthOpen(true);
  };

  const handleGetStarted = () => {
    if (user) navigate("/upload");
    else openAuth("signup");
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      // Sign-in with password takes precedence when the field is filled.
      // Signup path + "Send magic link" path both still use signInWithOtp.
      if (authTab === "signin" && authPassword) {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        // No magic-link confirmation screen; just close the dialog.
        setAuthOpen(false);
        setAuthPassword("");
      } else {
        const metadata = authTab === "signup"
          ? { first_name: authFirst, last_name: authLast, brokerage: authBrokerage }
          : undefined;
        const { error } = await supabase.auth.signInWithOtp({
          email: authEmail,
          options: {
            emailRedirectTo: AUTH_CALLBACK_URL,
            data: metadata,
          },
        });
        if (error) throw error;
        setAuthSent(true);
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAuthLoading(false);
    }
  };

  const showcase = [
    { src: showcaseInterior.url, poster: interior1, label: "Interior", index: "01", tall: true },
    { src: showcaseKitchen.url, poster: kitchen1, label: "Kitchen", index: "02" },
    { src: showcaseBathroom.url, poster: bathroom1, label: "Bathroom", index: "03" },
    { src: showcaseExterior.url, poster: exterior1, label: "Exterior", index: "04" },
    { src: showcaseAerial.url, poster: aerial1, label: "Aerial", index: "05" },
    { src: showcaseBeach.url, poster: aerial1, label: "Coastal", index: "06" },
  ];

  const faqs = [
    { q: "How many photos do I need?", a: "Upload 10 to 60 high-resolution property photos. More photos give the engine more material to compose from — a mix of exterior, interior, and detail shots produces the most cinematic result." },
    { q: "How fast is delivery?", a: "Every video is delivered within 72 hours. The pipeline runs a six-stage process — intake, analysis, scripting, generation, quality control, and assembly — around the clock." },
    { q: "What formats do I receive?", a: "Vertical 9:16 for Reels and TikTok, horizontal 16:9 for YouTube and MLS, or both. Every video ships with transitions, music, and optional AI voiceover included." },
    { q: "Can I request revisions?", a: "Yes. One revision round is included at no additional cost. Flag anything you want changed from your status page and we'll deliver the update within 48 hours." },
    { q: "How does pricing compare to traditional video?", a: "Real estate videographers charge $500 to $2,000 per listing with a one to two week turnaround. Listing Elevate starts at $75, delivered in 72 hours. Up to 85% less, at cinematic quality." },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ─── Navigation (liquid glass) ─── */}
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-white/[0.04] backdrop-blur-2xl backdrop-saturate-[180%] supports-[backdrop-filter]:bg-white/[0.05]">
        <nav className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-8 md:h-[76px] md:px-12">
          <Link to="/" className="inline-flex items-center gap-2.5 text-white transition-opacity hover:opacity-80">
            <span className="relative inline-block h-6 w-6" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="22" height="22" stroke="currentColor" strokeWidth="1.5" />
                <rect x="5" y="14" width="3" height="5" fill="currentColor" />
                <rect x="10.5" y="10" width="3" height="9" fill="currentColor" />
                <rect x="16" y="6" width="3" height="13" fill="currentColor" />
              </svg>
            </span>
            <span className="text-base font-semibold tracking-[-0.01em] leading-none">
              Listing Elevate
            </span>
          </Link>
          <div className="hidden items-center gap-10 md:flex">
            <a href="#process" className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-white">Process</a>
            <a href="#showcase" className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-white">Showcase</a>
            <a href="#pricing" className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-white">Pricing</a>
            <a href="#faq" className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-white">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="inline-flex h-9 w-9 items-center justify-center border border-white/20 text-white/80 transition-all duration-500 ease-cinematic hover:border-white/60 hover:bg-white/10"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {user ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="border-white/30 bg-white/5 text-white hover:border-white hover:bg-white hover:text-black"
              >
                <Link to={accountHref}>{accountLabel}</Link>
              </Button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => openAuth("signin")}
                  className="hidden text-[13px] font-medium text-white/70 transition-colors hover:text-white md:block"
                >
                  Sign in
                </button>
                <Button
                  size="sm"
                  onClick={handleGetStarted}
                  className="bg-white text-black hover:bg-white/90"
                >
                  Get started
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* ─── Hero ─── */}
      <section ref={heroRef} className="relative flex h-screen min-h-[720px] w-full items-center justify-center overflow-hidden">
        <motion.div style={{ scale: heroScale }} className="absolute inset-0">
          <video
            autoPlay
            loop
            muted
            playsInline
            poster={heroBg}
            className="absolute inset-0 h-full w-full object-cover"
          >
            <source src={heroVideo.url} type="video/mp4" />
          </video>
        </motion.div>
        {/* Cinematic gradient — always dark over video, independent of theme */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/35 to-black/90" />
        <div
          className="absolute inset-0"
          style={{
            boxShadow:
              "inset 0 160px 180px -60px rgba(0,0,0,0.7), inset 0 -160px 200px -40px rgba(0,0,0,0.85)",
          }}
        />

        <motion.div
          style={{ opacity: heroOpacity, y: heroY }}
          className="relative z-10 mx-auto w-full max-w-[1440px] px-8 md:px-12"
        >
          <motion.div
            initial="hidden"
            animate="visible"
            variants={stagger}
            className="max-w-4xl"
          >
            <motion.span
              variants={fadeUp}
              className="label block text-white/60"
            >
              — Listing Elevate. Cinematic, on demand.
            </motion.span>
            <motion.h1
              variants={fadeUp}
              className="mt-8 whitespace-nowrap font-semibold tracking-[-0.035em] text-white"
              style={{ fontSize: "clamp(2.25rem, 6vw, 5.5rem)", lineHeight: 1 }}
            >
              <span aria-live="polite">{heroText}</span>
              <span
                aria-hidden
                className="ml-[0.05em] inline-block w-[0.06em] animate-hero-caret bg-white align-baseline"
                style={{ height: "0.85em", verticalAlign: "-0.05em" }}
              />
              {" "}more listings.
            </motion.h1>
            <motion.p
              variants={fadeUp}
              className="mt-10 max-w-xl text-base leading-relaxed text-white/75 md:text-lg"
            >
              Upload photos. Receive a directed, edited, cinematic listing video within 72 hours. No crew, no scheduling, no post-production.
            </motion.p>
            <motion.div variants={fadeUp} className="mt-12 flex flex-wrap items-center gap-4">
              <Button
                size="xl"
                onClick={handleGetStarted}
                className="bg-white text-black hover:bg-white/90"
              >
                Start a video
                <ArrowRight className="h-4 w-4" />
              </Button>
              {!user && (
                <button
                  type="button"
                  onClick={() => openAuth("signin")}
                  className="group inline-flex items-center gap-2 text-[13px] font-medium text-white/80 transition-colors hover:text-white"
                >
                  <span className="border-b border-white/30 pb-1 transition-colors group-hover:border-white">
                    Sign in to your account
                  </span>
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              )}
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Bottom meta strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 1, ease: EASE }}
          className="absolute bottom-8 left-0 right-0 z-10 mx-auto flex max-w-[1440px] items-end justify-between px-8 md:px-12"
        >
          <div className="label text-white/50">
            <span className="tabular text-white/80">72h</span> delivery
          </div>
          <div className="hidden label text-white/50 md:block">
            From <span className="tabular text-white/80">$75</span>
          </div>
          <div className="label text-white/50">
            Scroll to explore
          </div>
        </motion.div>
      </section>

      {/* ─── Section: Process ─── */}
      <section id="process" className="relative border-t border-border px-8 py-32 md:px-12 md:py-40">
        <div className="mx-auto max-w-[1440px]">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-120px" }}
            variants={stagger}
            className="grid gap-12 md:grid-cols-[1fr_2fr] md:gap-20"
          >
            <motion.div variants={fadeUp}>
              <span className="label text-muted-foreground">— 01 / Process</span>
              <h2 className="display-lg mt-6 text-foreground">
                Three steps.
                <br />
                <span className="text-muted-foreground">No crew.</span>
              </h2>
            </motion.div>
            <motion.p
              variants={fadeUp}
              custom={1}
              className="self-end text-base leading-relaxed text-muted-foreground md:text-lg"
            >
              The same cinematic pipeline that powers premium listing firms, compressed into a 72-hour automated workflow. Upload, wait, deliver.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={stagger}
            className="mt-20 grid gap-px bg-border md:grid-cols-3"
          >
            {[
              {
                index: "01",
                title: "Upload",
                copy: "Drop 10 to 60 property photos. Select your package, duration, and format. Three minutes, start to finish.",
                image: kitchen1,
              },
              {
                index: "02",
                title: "Direct",
                copy: "The engine analyses each frame, drafts a shot list, runs multi-model QA, and generates cinematic camera moves.",
                image: interior1,
              },
              {
                index: "03",
                title: "Deliver",
                copy: "Your final cut arrives within 72 hours — in vertical, horizontal, or both. Ready for every channel.",
                image: aerial1,
              },
            ].map((step, i) => (
              <motion.div
                key={step.index}
                variants={fadeUp}
                custom={i}
                className="group relative overflow-hidden bg-background"
              >
                <div className="aspect-[4/5] overflow-hidden">
                  <img
                    src={step.image}
                    alt={step.title}
                    className="h-full w-full object-cover transition-transform [transition-duration:1400ms] ease-cinematic group-hover:scale-[1.04]"
                    loading="lazy"
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-8">
                  <span className="label text-white/50">— {step.index}</span>
                  <h3 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-white md:text-3xl">
                    {step.title}
                  </h3>
                  <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/75">
                    {step.copy}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Section: Showcase ─── */}
      <section id="showcase" className="border-t border-border bg-secondary/30 px-8 py-32 md:px-12 md:py-40">
        <div className="mx-auto max-w-[1440px]">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-120px" }}
            variants={stagger}
            className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between"
          >
            <motion.div variants={fadeUp}>
              <span className="label text-muted-foreground">— 02 / Showcase</span>
              <h2 className="display-lg mt-6 text-foreground">
                Generated from stills.
                <br />
                <span className="text-muted-foreground">Every frame.</span>
              </h2>
            </motion.div>
            <motion.p variants={fadeUp} custom={1} className="max-w-md text-base leading-relaxed text-muted-foreground">
              Six cuts. Every one produced end-to-end from property photography by the Listing Elevate pipeline.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="mt-20 grid grid-cols-2 gap-1 md:grid-cols-4 md:grid-rows-2"
          >
            {showcase.map((v, i) => (
              <motion.figure
                key={v.label}
                variants={fadeUp}
                custom={i}
                className={`group relative overflow-hidden bg-black ${i === 0 ? "md:col-span-2 md:row-span-2" : ""}`}
              >
                <video
                  autoPlay
                  loop
                  muted
                  playsInline
                  poster={v.poster}
                  className={`w-full object-cover transition-transform [transition-duration:1400ms] ease-cinematic group-hover:scale-[1.04] ${
                    i === 0 ? "h-full min-h-[420px] md:min-h-[640px]" : "h-[220px] md:h-[310px]"
                  }`}
                >
                  <source src={v.src} type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between p-5">
                  <span className="label text-white/90">{v.label}</span>
                  <span className="label tabular text-white/40">— {v.index}</span>
                </figcaption>
              </motion.figure>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Section: Pricing / Compare ─── */}
      <section id="pricing" className="border-t border-border px-8 py-32 md:px-12 md:py-40">
        <div className="mx-auto max-w-[1440px]">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-120px" }}
            variants={stagger}
            className="max-w-2xl"
          >
            <motion.span variants={fadeUp} className="label text-muted-foreground">
              — 03 / The economics
            </motion.span>
            <motion.h2 variants={fadeUp} custom={1} className="display-lg mt-6">
              85% less.
              <br />
              <span className="text-muted-foreground">Same cinema.</span>
            </motion.h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={stagger}
            className="mt-20 grid gap-px border border-border bg-border md:grid-cols-3"
          >
            {[
              { label: "Starting at", ours: "$75", theirs: "$500+", theirsLabel: "Traditional videographer" },
              { label: "Turnaround", ours: "72 hours", theirs: "1–2 weeks", theirsLabel: "Production + post" },
              { label: "Formats included", ours: "Both", theirs: "One", theirsLabel: "Vertical or horizontal" },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                variants={fadeUp}
                custom={i}
                className="bg-background p-10"
              >
                <span className="label text-muted-foreground">{stat.label}</span>
                <div className="mt-6 flex items-baseline gap-4">
                  <span className="tabular text-5xl font-semibold tracking-[-0.035em] text-foreground md:text-6xl">
                    {stat.ours}
                  </span>
                  <span className="tabular text-sm text-muted-foreground/60 line-through">{stat.theirs}</span>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">{stat.theirsLabel}</p>
              </motion.div>
            ))}
          </motion.div>

          <div className="mt-16 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
            <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
              Four packages, three durations, two orientations. Start with a 15-second Just Listed at $75 — upgrade any time.
            </p>
            <Button size="lg" onClick={handleGetStarted}>
              See packages
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ─── Full-bleed CTA ─── */}
      <section className="relative h-[70vh] min-h-[560px] overflow-hidden border-t border-border">
        <motion.img
          src={aerial1}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          initial={{ scale: 1.12 }}
          whileInView={{ scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 2, ease: EASE }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/90" />
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: EASE }}
          className="relative z-10 mx-auto flex h-full max-w-[1440px] flex-col items-start justify-end px-8 pb-24 md:px-12 md:pb-32"
        >
          <span className="label text-white/60">— The next step</span>
          <h2 className="mt-6 max-w-3xl font-semibold tracking-[-0.035em] text-white" style={{ fontSize: "clamp(2.5rem, 6vw, 5.5rem)", lineHeight: 1 }}>
            Your next listing,
            <br />
            elevated.
          </h2>
          <Button
            size="xl"
            className="mt-12 bg-white text-black hover:bg-white/90"
            onClick={handleGetStarted}
          >
            Start your first video
            <ArrowRight className="h-4 w-4" />
          </Button>
        </motion.div>
      </section>

      {/* ─── FAQ ─── */}
      <section id="faq" className="border-t border-border px-8 py-32 md:px-12 md:py-40">
        <div className="mx-auto grid max-w-[1440px] gap-16 md:grid-cols-[1fr_2fr] md:gap-24">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-120px" }}
            variants={stagger}
          >
            <motion.span variants={fadeUp} className="label text-muted-foreground">
              — 04 / Frequently asked
            </motion.span>
            <motion.h2 variants={fadeUp} custom={1} className="display-lg mt-6">
              Questions,
              <br />
              <span className="text-muted-foreground">answered.</span>
            </motion.h2>
          </motion.div>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={stagger}
            className="border-t border-border"
          >
            {faqs.map((f, i) => (
              <motion.div key={i} variants={fadeUp} custom={i}>
                <FAQItem question={f.q} answer={f.a} />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-border bg-secondary/20 px-8 py-20 md:px-12">
        <div className="mx-auto max-w-[1440px]">
          <div className="grid gap-16 md:grid-cols-[2fr_1fr_1fr_1fr]">
            <div>
              <LELogoMark size={44} variant="dark" />
              <p className="mt-6 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Cinematic real-estate video, automated. Every listing, in motion — delivered in 72 hours.
              </p>
            </div>
            <div>
              <h4 className="label mb-5 text-foreground">Platform</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><Link to="/upload" className="transition-colors hover:text-foreground">New video</Link></li>
                <li><Link to="/presets" className="transition-colors hover:text-foreground">Presets</Link></li>
                <li><Link to={accountHref} className="transition-colors hover:text-foreground">{accountLabel}</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="label mb-5 text-foreground">Company</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><a href="#process" className="transition-colors hover:text-foreground">Process</a></li>
                <li><a href="#showcase" className="transition-colors hover:text-foreground">Showcase</a></li>
                <li><a href="#pricing" className="transition-colors hover:text-foreground">Pricing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="label mb-5 text-foreground">Contact</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><a href="mailto:help@listingelevate.com" className="transition-colors hover:text-foreground">help@listingelevate.com</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-20 flex flex-col gap-4 border-t border-border pt-10 md:flex-row md:items-center md:justify-between">
            <span className="label text-muted-foreground">© 2026 Listing Elevate</span>
            <div className="flex gap-8">
              <span className="label text-muted-foreground">Privacy</span>
              <span className="label text-muted-foreground">Terms</span>
            </div>
          </div>
        </div>
      </footer>

      {/* ─── Auth modal ─── */}
      <Dialog open={authOpen} onOpenChange={setAuthOpen}>
        <DialogContent className="max-w-md gap-0 overflow-hidden rounded-none p-0">
          {authSent ? (
            <div className="space-y-5 p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center border border-accent/30 bg-accent/10 text-accent">
                <CheckCircle className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-semibold tracking-[-0.02em]">Check your email.</h2>
              <p className="text-sm text-muted-foreground">
                Magic link sent to <span className="font-medium text-foreground">{authEmail}</span>.
              </p>
              <button
                type="button"
                onClick={() => {
                  setAuthSent(false);
                  setAuthEmail("");
                }}
                className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <div className="flex border-b border-border">
                {(["signin", "signup"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setAuthTab(t)}
                    className={`relative flex-1 py-4 text-[11px] font-medium uppercase tracking-[0.18em] transition-colors ${
                      authTab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "signin" ? "Sign in" : "Create account"}
                    {authTab === t && (
                      <motion.span
                        layoutId="auth-tab-underline"
                        className="absolute inset-x-0 bottom-[-1px] h-[2px] bg-foreground"
                        transition={{ duration: 0.4, ease: EASE }}
                      />
                    )}
                  </button>
                ))}
              </div>

              <form onSubmit={handleAuthSubmit} className="space-y-5 p-8">
                {authTab === "signup" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label className="label text-muted-foreground">First name</Label>
                        <Input value={authFirst} onChange={(e) => setAuthFirst(e.target.value)} placeholder="Jane" required />
                      </div>
                      <div className="space-y-2">
                        <Label className="label text-muted-foreground">Last name</Label>
                        <Input value={authLast} onChange={(e) => setAuthLast(e.target.value)} placeholder="Smith" required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="label text-muted-foreground">Brokerage</Label>
                      <Input value={authBrokerage} onChange={(e) => setAuthBrokerage(e.target.value)} placeholder="Compass, Keller Williams…" required />
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <Label className="label text-muted-foreground">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                    <Input
                      type="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="you@brokerage.com"
                      required
                      autoFocus
                      className="pl-11"
                    />
                  </div>
                </div>

                {authTab === "signin" && (
                  <div className="space-y-2">
                    <Label className="label text-muted-foreground">
                      Password <span className="text-muted-foreground/60">(optional — leave blank for magic link)</span>
                    </Label>
                    <Input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                  </div>
                )}

                {authError && (
                  <p className="text-xs text-destructive">{authError}</p>
                )}

                <Button type="submit" className="w-full" size="lg" disabled={authLoading || !authEmail}>
                  {authLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      {authTab === "signup"
                        ? "Create account"
                        : authPassword
                          ? "Sign in"
                          : "Send magic link"}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  {authTab === "signin" ? (
                    <>
                      No account?{" "}
                      <button type="button" onClick={() => setAuthTab("signup")} className="text-foreground underline underline-offset-4">
                        Create one
                      </button>
                    </>
                  ) : (
                    <>
                      Already registered?{" "}
                      <button type="button" onClick={() => setAuthTab("signin")} className="text-foreground underline underline-offset-4">
                        Sign in
                      </button>
                    </>
                  )}
                </p>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
