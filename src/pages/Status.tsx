import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Download, Loader2, AlertTriangle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { fetchPropertyStatus } from "@/lib/api";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const stages = [
  { key: "uploaded", label: "Received", desc: "Photos secured" },
  { key: "analyzing", label: "Analyzing", desc: "Reading every frame" },
  { key: "scripting", label: "Directing", desc: "Drafting the shot list" },
  { key: "generating", label: "Generating", desc: "Camera motion engine" },
  { key: "qc", label: "Quality control", desc: "Multi-pass review" },
  { key: "complete", label: "Delivered", desc: "Ready to share" },
];

interface StatusData {
  id: string;
  address: string;
  status: string;
  currentStage: number;
  totalStages: number;
  clipsCompleted: number;
  clipsTotal: number;
  horizontalVideoUrl: string | null;
  verticalVideoUrl: string | null;
  createdAt: string;
  processingTimeMs: number | null;
}

const Status = () => {
  const { id } = useParams();
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const result = await fetchPropertyStatus(id);
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoading(false);
        if (result.status !== "complete" && result.status !== "failed") {
          timer = setTimeout(poll, 5000);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load status");
        setLoading(false);
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-24 text-center text-foreground">
        <div className="flex h-14 w-14 items-center justify-center border border-destructive/40 bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
        </div>
        <div>
          <span className="label text-muted-foreground">— Not found</span>
          <h1 className="display-md mt-3">Video unavailable.</h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
            {error || "We can't find a video at this tracking ID. Check the link in your confirmation email."}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
        </Button>
      </div>
    );
  }

  const currentStage = data.currentStage;
  const isComplete = data.status === "complete";
  const isFailed = data.status === "failed";
  const elapsedHours = data.processingTimeMs ? Math.max(0, data.processingTimeMs / 1000 / 3600) : null;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-8 py-10 md:px-12">
          <div>
            <span className="label text-muted-foreground">— Tracking</span>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] md:text-3xl">{data.address}</h1>
            <p className="tabular mt-2 text-xs text-muted-foreground">{data.id}</p>
          </div>
          <Button asChild variant="outline" size="sm" className="hidden md:inline-flex">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" /> Home
            </Link>
          </Button>
        </div>
      </div>

      {/* Main */}
      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-16 px-8 py-16 md:px-12 md:py-24">
        {isFailed ? (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE }}
            className="border border-destructive/40 bg-destructive/5 p-10"
          >
            <div className="flex items-start gap-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-destructive/40 bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
              </div>
              <div>
                <span className="label text-destructive">— Failed</span>
                <h2 className="mt-3 text-xl font-semibold tracking-[-0.01em]">Production stopped.</h2>
                <p className="mt-3 max-w-md text-sm text-muted-foreground">
                  Something interrupted the pipeline. We're notified and will reach out shortly. You can also email{" "}
                  <a href="mailto:help@listingelevate.com" className="text-foreground underline underline-offset-4">
                    help@listingelevate.com
                  </a>
                  .
                </p>
              </div>
            </div>
          </motion.div>
        ) : (
          <>
            {/* Vertical timeline stepper */}
            <section>
              <span className="label text-muted-foreground">— Pipeline</span>
              <h2 className="mt-4 text-xl font-semibold tracking-[-0.01em]">
                {isComplete ? "Production complete." : "In production."}
              </h2>

              <div className="mt-12 grid gap-12 md:grid-cols-[280px_1fr]">
                {/* Left meta */}
                <div className="space-y-8">
                  <div>
                    <span className="label text-muted-foreground">Stage</span>
                    <div className="tabular mt-3 text-3xl font-semibold tracking-[-0.02em]">
                      {String(Math.min(currentStage + 1, stages.length)).padStart(2, "0")}
                      <span className="text-muted-foreground/40"> / {String(stages.length).padStart(2, "0")}</span>
                    </div>
                  </div>
                  {data.clipsTotal > 0 && (
                    <div>
                      <span className="label text-muted-foreground">Clips</span>
                      <div className="tabular mt-3 text-3xl font-semibold tracking-[-0.02em]">
                        {data.clipsCompleted}
                        <span className="text-muted-foreground/40"> / {data.clipsTotal}</span>
                      </div>
                    </div>
                  )}
                  {elapsedHours !== null && (
                    <div>
                      <span className="label text-muted-foreground">Elapsed</span>
                      <div className="tabular mt-3 text-3xl font-semibold tracking-[-0.02em]">
                        {elapsedHours.toFixed(1)}
                        <span className="ml-1 text-base text-muted-foreground">hr</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right timeline */}
                <ol className="relative">
                  {/* Continuous rail */}
                  <span aria-hidden className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />
                  <motion.span
                    aria-hidden
                    className="absolute left-[11px] top-2 w-px bg-foreground"
                    initial={{ height: 0 }}
                    animate={{
                      height: `${Math.max(0, (Math.min(currentStage, stages.length - 1) / (stages.length - 1)) * 100)}%`,
                    }}
                    transition={{ duration: 1, ease: EASE }}
                  />

                  {stages.map((stage, i) => {
                    const done = i < currentStage || (i === currentStage && isComplete);
                    const active = i === currentStage && !isComplete;
                    return (
                      <motion.li
                        key={stage.key}
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.7, delay: i * 0.06, ease: EASE }}
                        className="relative flex items-start gap-6 pb-12 last:pb-0"
                      >
                        <span
                          className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center border bg-background transition-colors duration-500 ${
                            done
                              ? "border-foreground text-foreground"
                              : active
                              ? "border-accent text-accent"
                              : "border-border text-muted-foreground/40"
                          }`}
                        >
                          {done ? (
                            <Check className="h-3 w-3" strokeWidth={2.5} />
                          ) : active ? (
                            <motion.span
                              animate={{ scale: [1, 1.4, 1] }}
                              transition={{ duration: 1.6, repeat: Infinity, ease: EASE }}
                              className="h-2 w-2 bg-accent"
                            />
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                          )}
                        </span>
                        <div className="flex-1 pb-1">
                          <div className="flex items-baseline gap-3">
                            <span className="tabular text-[10px] font-medium text-muted-foreground/60">
                              0{i + 1}
                            </span>
                            <h3
                              className={`text-base font-semibold tracking-[-0.01em] transition-colors ${
                                done ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground/50"
                              }`}
                            >
                              {stage.label}
                            </h3>
                            {active && <span className="label text-accent">— Now</span>}
                          </div>
                          <p
                            className={`mt-1.5 text-xs ${
                              done || active ? "text-muted-foreground" : "text-muted-foreground/40"
                            }`}
                          >
                            {stage.desc}
                          </p>
                        </div>
                      </motion.li>
                    );
                  })}
                </ol>
              </div>
            </section>

            {/* Delivery / preview */}
            {isComplete && (
              <motion.section
                initial={{ opacity: 0, y: 32 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1, ease: EASE }}
                className="border-t border-border pt-16"
              >
                <span className="label text-muted-foreground">— Delivery</span>
                <h2 className="display-md mt-4">Your video,
                  <br />
                  <span className="text-muted-foreground">delivered.</span>
                </h2>

                <div className="mt-12 grid gap-1 md:grid-cols-2">
                  {data.horizontalVideoUrl && (
                    <a
                      href={data.horizontalVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative block aspect-video overflow-hidden border border-border bg-secondary/40 transition-colors duration-500 hover:border-foreground/40"
                    >
                      <video src={data.horizontalVideoUrl} className="h-full w-full object-cover" muted loop playsInline />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity duration-500 group-hover:bg-black/50">
                        <span className="flex h-14 w-14 items-center justify-center border border-white/40 bg-black/30 text-white backdrop-blur-md">
                          <Play className="h-5 w-5" strokeWidth={1.5} />
                        </span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent p-5">
                        <span className="label text-white/90">Horizontal — 16:9</span>
                        <Download className="h-4 w-4 text-white/80" />
                      </div>
                    </a>
                  )}
                  {data.verticalVideoUrl && (
                    <a
                      href={data.verticalVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative block aspect-video overflow-hidden border border-border bg-secondary/40 transition-colors duration-500 hover:border-foreground/40"
                    >
                      <video src={data.verticalVideoUrl} className="h-full w-full object-cover" muted loop playsInline />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity duration-500 group-hover:bg-black/50">
                        <span className="flex h-14 w-14 items-center justify-center border border-white/40 bg-black/30 text-white backdrop-blur-md">
                          <Play className="h-5 w-5" strokeWidth={1.5} />
                        </span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent p-5">
                        <span className="label text-white/90">Vertical — 9:16</span>
                        <Download className="h-4 w-4 text-white/80" />
                      </div>
                    </a>
                  )}
                </div>

                <div className="mt-12 flex flex-wrap items-center gap-4">
                  <Button asChild>
                    <Link to="/upload">
                      Submit another listing
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/dashboard">View all videos</Link>
                  </Button>
                </div>
              </motion.section>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Status;
