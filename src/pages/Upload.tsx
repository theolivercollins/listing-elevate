import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  ArrowLeft,
  Bookmark,
  CheckCircle2,
  Loader2,
  Mic,
  RotateCcw,
  Sparkles,
  X,
  Home,
  Flame,
  Trophy,
  Layers,
  RectangleVertical,
  RectangleHorizontal,
  Square,
  Camera,
  Check,
  Search,
} from "lucide-react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getPresets, savePreset, type Preset } from "@/lib/presets";
import { createProperty, generateVoiceoverPreview, scrapeMls } from "@/lib/api";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { SiteNav } from "@/v2/components/SiteNav";
import "@/v2/styles/v2.css";

// Voice catalog for the AI voiceover panel — kept in sync with lib/voiceover/voices.ts
const VOICE_CATALOG = [
  { id: "UgBBYS2sOqTuMpoF3BR0", name: "Mark",    gender: "male" as const,   description: "Natural, conversational" },
  { id: "dtSEyYGNJqjrtBArPCVZ", name: "Jack",    gender: "male" as const,   description: "Deep, commanding narrator" },
  { id: "F7hCTbeEDbm7osolS21j", name: "Amanda",  gender: "female" as const, description: "Warm, polished, informative" },
  { id: "kdmDKE6EkgrWrrykO9Qt", name: "Jessica", gender: "female" as const, description: "Young, conversational, natural" },
];

interface UploadedFile {
  file: File;
  preview: string;
  id: string;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const stepFade: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
  exit: { opacity: 0, y: -24, transition: { duration: 0.4, ease: EASE } },
};

// Step order: Style → Property → Add-ons → Photos
const STEPS = ["Style", "Property", "Add-ons", "Photos"] as const;
type StepId = 0 | 1 | 2 | 3;

const Upload = () => {
  // ─── form state ───
  const [step, setStep] = useState<StepId>(0);
  const [address, setAddress] = useState("");
  const [price, setPrice] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [agent, setAgent] = useState("");
  const [daysOnMarket, setDaysOnMarket] = useState("");
  const [soldPrice, setSoldPrice] = useState("");
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<string | null>(null);
  const [selectedOrientation, setSelectedOrientation] = useState<string | null>(null);
  const [addVoiceover, setAddVoiceover] = useState(false);
  const [addVoiceClone, setAddVoiceClone] = useState(false);
  const [addCustomRequest, setAddCustomRequest] = useState(false);
  const [customRequestText, setCustomRequestText] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);

  // ─── voiceover panel state ───
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [compassUrl, setCompassUrl] = useState("");
  const [voiceoverGenerating, setVoiceoverGenerating] = useState(false);
  const [voiceoverError, setVoiceoverError] = useState<string | null>(null);
  const [voiceoverPreviewUrl, setVoiceoverPreviewUrl] = useState<string | null>(null);
  const [voiceoverScript, setVoiceoverScript] = useState<string | null>(null);
  const [voiceoverStage, setVoiceoverStage] = useState<string | null>(null);
  const [lastUsedVoiceId, setLastUsedVoiceId] = useState<string | null>(null);

  // ─── MLS auto-fill state ───
  const [mlsUrl, setMlsUrl] = useState("");
  const [mlsScraping, setMlsScraping] = useState(false);
  const [mlsError, setMlsError] = useState<string | null>(null);
  const [mlsPanelOpen, setMlsPanelOpen] = useState(false);

  // ─── flow state ───
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [trackingId, setTrackingId] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; total: number } | null>(null);

  // ─── presets ───
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetSaved, setPresetSaved] = useState(false);
  const [hasPresets, setHasPresets] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const applyPreset = (preset: Preset) => {
    setSelectedPackage(preset.selectedPackage);
    setSelectedDuration(preset.selectedDuration);
    setSelectedOrientation(preset.selectedOrientation);
    setAddVoiceover(preset.addVoiceover);
    setAddVoiceClone(preset.addVoiceClone);
    setAddCustomRequest(preset.addCustomRequest);
    setCustomRequestText(preset.customRequestText);
  };

  useEffect(() => {
    const presetId = searchParams.get("preset");
    if (presetId) {
      getPresets().then((presets) => {
        const preset = presets.find((p) => p.id === presetId);
        if (preset) applyPreset(preset);
      });
    }
    getPresets().then((presets) => setHasPresets(presets.length > 0));
  }, [searchParams]);

  const handleUseLastPreset = async () => {
    const presets = await getPresets();
    if (presets.length > 0) applyPreset(presets[presets.length - 1]);
  };

  const handleSavePreset = async () => {
    if (!presetName.trim()) return;
    await savePreset({
      name: presetName.trim(),
      selectedPackage,
      selectedDuration,
      selectedOrientation,
      addVoiceover,
      addVoiceClone,
      addCustomRequest,
      customRequestText,
    });
    setPresetSaved(true);
    setTimeout(() => {
      setShowSavePreset(false);
      setPresetName("");
      setPresetSaved(false);
    }, 1200);
  };

  // ─── MLS auto-fill ───
  const handleMlsScrape = async () => {
    if (!mlsUrl.trim()) return;
    setMlsScraping(true);
    setMlsError(null);
    try {
      const r = await scrapeMls(mlsUrl.trim());
      if (r.address && !address) setAddress(r.address);
      if (r.price != null && !price) setPrice(String(r.price));
      if (r.bedrooms != null && !bedrooms) setBedrooms(String(r.bedrooms));
      if (r.bathrooms != null && !bathrooms) setBathrooms(String(r.bathrooms));
      if (r.agent && !agent) setAgent(r.agent);
      setMlsPanelOpen(false);
      setMlsUrl("");
    } catch (e) {
      setMlsError(e instanceof Error ? e.message : "Failed to fetch listing details");
    } finally {
      setMlsScraping(false);
    }
  };

  // ─── catalog ───
  const packages = [
    { id: "just_listed", name: "Just Listed", desc: "New to market", icon: Home },
    { id: "just_pended", name: "Just Pended", desc: "Under contract", icon: Flame },
    { id: "just_closed", name: "Just Closed", desc: "Successful close", icon: Trophy },
    { id: "life_cycle", name: "Life Cycle", desc: "Three-video series", icon: Layers, badge: "Best value" },
  ];

  const durations = [
    { id: "15s", label: "15", price: 75, lifeCyclePrice: 90 },
    { id: "30s", label: "30", price: 125, lifeCyclePrice: 140 },
    { id: "60s", label: "60", price: 175, lifeCyclePrice: 190 },
  ];

  // Horizontal is primary (index 0); vertical and both are coming soon.
  const orientations = [
    { id: "horizontal", label: "Horizontal", ratio: "16:9", icon: RectangleHorizontal, extra: 0 },
    { id: "vertical", label: "Vertical", ratio: "9:16", icon: RectangleVertical, extra: 0, comingSoon: true },
    { id: "both", label: "Both", ratio: "9:16 + 16:9", icon: Square, extra: 10, comingSoon: true },
  ];

  const selectedDur = durations.find((d) => d.id === selectedDuration);
  const isLifeCycle = selectedPackage === "life_cycle";
  const basePrice = selectedDur ? (isLifeCycle ? selectedDur.lifeCyclePrice : selectedDur.price) : 0;
  const orientationExtra = isLifeCycle ? 0 : (orientations.find((o) => o.id === selectedOrientation)?.extra || 0);
  const voiceoverExtra = addVoiceover ? 15 : 0;
  const customExtra = addCustomRequest ? 15 : 0;
  const voiceCloneExtra = addVoiceClone ? 15 : 0;
  const totalPrice = basePrice + orientationExtra + voiceoverExtra + customExtra + voiceCloneExtra;

  const needsDaysOnMarket = selectedPackage === "just_pended" || selectedPackage === "just_closed";
  const needsSoldPrice = selectedPackage === "just_closed";

  // ─── per-step validity (new order: 0=Style, 1=Property, 2=Add-ons, 3=Photos) ───
  const step0Valid = !!(selectedPackage && selectedDuration && selectedOrientation);
  // Step 1 = Property
  const step1Valid = !!(
    address &&
    price &&
    bedrooms &&
    bathrooms &&
    agent &&
    (!needsDaysOnMarket || daysOnMarket) &&
    (!needsSoldPrice || soldPrice)
  );
  // Step 2 = Add-ons
  const step2Valid = !addCustomRequest || customRequestText.trim().length > 0;
  const step3Valid = files.length >= 10;
  const stepValidity = [step0Valid, step1Valid, step2Valid, step3Valid] as const;
  const canAdvance = stepValidity[step];
  const canSubmit = stepValidity.every(Boolean);

  // Auto-select horizontal orientation (only available option for now)
  useEffect(() => {
    if (!selectedOrientation) setSelectedOrientation("horizontal");
  }, [selectedOrientation]);

  // ─── files ───
  const handleFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const accepted = Array.from(newFiles).filter((f) => /\.(jpg|jpeg|png|heic|webp)$/i.test(f.name));
      const remaining = 60 - files.length;
      const toAdd = accepted.slice(0, remaining);
      const mapped = toAdd.map((f) => ({ file: f, preview: URL.createObjectURL(f), id: crypto.randomUUID() }));
      setFiles((prev) => [...prev, ...mapped]);
    },
    [files.length],
  );

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const removed = prev.find((f) => f.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);
  const formatSize = (bytes: number) =>
    bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  // ─── voiceover generation ───
  const handleGenerateVoiceover = async () => {
    if (!selectedVoiceId || !selectedDuration) return;
    const isVoiceOnlyRerender =
      !!voiceoverScript &&
      !!voiceoverPreviewUrl &&
      !!lastUsedVoiceId &&
      selectedVoiceId !== lastUsedVoiceId;

    if (!isVoiceOnlyRerender && !compassUrl) return;

    const durationSec = parseInt(selectedDuration.replace(/s$/, ""), 10);
    setVoiceoverGenerating(true);
    setVoiceoverError(null);
    if (!isVoiceOnlyRerender) {
      setVoiceoverPreviewUrl(null);
      setVoiceoverScript(null);
    }

    let clearStages = () => {};
    if (isVoiceOnlyRerender) {
      setVoiceoverStage("Recording the new voiceover…");
    } else {
      setVoiceoverStage("Reading your listing…");
      const t1 = setTimeout(() => setVoiceoverStage("Writing your script…"), 12_000);
      const t2 = setTimeout(() => setVoiceoverStage("Recording the voiceover…"), 22_000);
      const t3 = setTimeout(() => setVoiceoverStage("Almost done…"), 38_000);
      clearStages = () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }

    try {
      const result = await generateVoiceoverPreview({
        voiceId: selectedVoiceId,
        durationSec,
        compassUrl,
        script: isVoiceOnlyRerender ? voiceoverScript! : undefined,
      });
      setVoiceoverPreviewUrl(result.audioUrl);
      setVoiceoverScript(result.script);
      setLastUsedVoiceId(result.voice.id);
    } catch (err) {
      setVoiceoverError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      clearStages();
      setVoiceoverGenerating(false);
      setVoiceoverStage(null);
    }
  };

  // ─── submit ───
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createProperty(
        {
          address,
          price: Number(price),
          bedrooms: Number(bedrooms),
          bathrooms: Number(bathrooms),
          listing_agent: agent,
          brokerage: "",
          photos: files.map((f) => f.file),
          selectedPackage,
          selectedDuration,
          selectedOrientation,
          addVoiceover,
          addVoiceClone,
          addCustomRequest,
          customRequestText,
          daysOnMarket,
          soldPrice,
          voiceoverPreviewUrl: voiceoverPreviewUrl ?? undefined,
        },
        (uploaded, total) => setUploadProgress({ uploaded, total }),
      );
      setTrackingId(result.id);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit property");
    } finally {
      setSubmitting(false);
    }
  };

  // ─── nav ───
  const next = () => {
    if (step < 3 && canAdvance) setStep((s) => (s + 1) as StepId);
  };
  const back = () => {
    if (step > 0) setStep((s) => (s - 1) as StepId);
  };

  // ─── success ───
  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col" style={{ background: "var(--le-bg)", color: "var(--le-text)", fontFamily: "var(--le-font-sans)" }}>
        <div className="flex flex-1 items-center justify-center px-6 py-24">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE }}
            className="w-full max-w-md text-center"
          >
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, duration: 0.8, ease: EASE }}
              className="mx-auto mb-10 flex h-20 w-20 items-center justify-center border border-accent/40 bg-accent/10 text-accent"
            >
              <CheckCircle2 className="h-9 w-9" strokeWidth={1.5} />
            </motion.div>
            <span className="label text-muted-foreground">— In production</span>
            <h1 className="display-md mt-5">
              Your video
              <br />
              is in motion.
            </h1>
            <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
              {files.length} photos received. Estimated delivery in 72 hours. We'll email you when it's ready.
            </p>
            <div className="mt-12 border border-border">
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <span className="label text-muted-foreground">Tracking</span>
                <span className="tabular text-xs font-semibold text-foreground">{trackingId.slice(0, 8)}</span>
              </div>
              <div className="flex items-center justify-between px-6 py-4">
                <span className="label text-muted-foreground">Total</span>
                <span className="tabular text-base font-semibold text-foreground">${totalPrice}</span>
              </div>
            </div>
            <Button size="lg" className="mt-8 w-full" onClick={() => navigate(`/status/${trackingId}`)}>
              Track production
              <ArrowRight className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
            >
              Submit another listing
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  // ─── main ───
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--le-bg)", color: "var(--le-text)", fontFamily: "var(--le-font-sans)", paddingTop: 80 }}>
      <SiteNav showSectionLinks={false} solid />
      {/* Step header */}
      <div style={{ borderBottom: "1px solid var(--le-border)" }}>
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-6 px-8 py-8 md:px-12">
          <div>
            <h1 style={{ fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 500, letterSpacing: "-0.035em", color: "var(--le-text)", fontFamily: "var(--le-font-sans)" }}>
              {step === 0 && "Create a New Video"}
              {step === 1 && "Property Details"}
              {step === 2 && "Add Upgrades"}
              {step === 3 && "Upload Your Photos"}
            </h1>
          </div>
          {hasPresets && (
            <button
              type="button"
              onClick={handleUseLastPreset}
              className="hidden items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground md:flex"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Use last preset
            </button>
          )}
        </div>

        {/* Step rail */}
        <div className="mx-auto max-w-[1080px] px-8 pb-6 md:px-12">
          <div className="flex items-center gap-3">
            {STEPS.map((label, i) => {
              const active = i === step;
              const done = i < step;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (i < step || (i === step + 1 && canAdvance)) setStep(i as StepId);
                  }}
                  className="group flex flex-1 flex-col items-start gap-2 text-left"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="tabular text-[10px] font-medium"
                      style={{ color: active || done ? "var(--le-text)" : "var(--le-text-faint)" }}
                    >
                      0{i + 1}
                    </span>
                    <span
                      className="text-[11px] font-medium uppercase tracking-[0.18em] transition-colors"
                      style={{ color: active ? "var(--le-text)" : done ? "var(--le-text-muted)" : "var(--le-text-faint)" }}
                    >
                      {label}
                    </span>
                    {done && <Check className="h-3 w-3 text-accent" />}
                  </span>
                  <span
                    style={{
                      height: 1,
                      width: "100%",
                      transition: "background 0.7s",
                      background: active ? "var(--le-text)" : done ? "var(--le-text-faint)" : "var(--le-border)",
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step body */}
      <div className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-[1080px] px-8 py-16 md:px-12 md:py-24">
          <AnimatePresence mode="wait">
            {/* ─── Step 0 — Style ─── */}
            {step === 0 && (
              <motion.div key="step-0" variants={stepFade} initial="hidden" animate="visible" exit="exit" className="space-y-12">
                {/* Package */}
                <section>
                  <h2 className="text-xl font-semibold tracking-[-0.01em]">Select Video Type</h2>
                  <div className="mt-8 grid gap-px md:grid-cols-2" style={{ background: "var(--le-border)" }}>
                    {packages.map((pkg) => {
                      const Icon = pkg.icon;
                      const sel = selectedPackage === pkg.id;
                      return (
                        <button
                          key={pkg.id}
                          type="button"
                          onClick={() => setSelectedPackage(pkg.id)}
                          className="group relative flex items-start gap-5 p-6 text-left transition-all duration-500 ease-cinematic"
                          style={{ background: sel ? "var(--le-bg-elev)" : "var(--le-bg)" }}
                        >
                          <span
                            className={`flex h-12 w-12 shrink-0 items-center justify-center border transition-colors duration-500 ${
                              sel ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground group-hover:border-foreground/40"
                            }`}
                          >
                            <Icon className="h-5 w-5" strokeWidth={1.5} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-3">
                              <h3 className="text-base font-semibold tracking-[-0.01em]">{pkg.name}</h3>
                              {pkg.badge && (
                                <span className="label text-accent">— {pkg.badge}</span>
                              )}
                            </div>
                            <p className="mt-1.5 text-xs text-muted-foreground">{pkg.desc}</p>
                          </div>
                          {sel && <Check className="h-4 w-4 text-foreground" />}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Duration */}
                <section>
                  <h2 className="text-xl font-semibold tracking-[-0.01em]">Select Duration</h2>
                  <div className="mt-8 grid gap-px md:grid-cols-3" style={{ background: "var(--le-border)" }}>
                    {durations.map((d) => {
                      const sel = selectedDuration === d.id;
                      const p = isLifeCycle ? d.lifeCyclePrice : d.price;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setSelectedDuration(d.id)}
                          className="group flex items-end justify-between p-6 text-left transition-all duration-500 ease-cinematic"
                          style={{ background: sel ? "var(--le-bg-elev)" : "var(--le-bg)" }}
                        >
                          <div>
                            <div className="flex items-baseline gap-1">
                              <span className="tabular text-4xl font-semibold tracking-[-0.03em]">{d.label}</span>
                              <span className="text-xs text-muted-foreground">sec</span>
                            </div>
                            {isLifeCycle && (
                              <span className="label mt-3 inline-block text-accent">— Bundle save $25</span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="tabular text-base font-semibold">${p}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Orientation */}
                <section>
                  <h2 className="text-xl font-semibold tracking-[-0.01em]">Select Format</h2>
                  <div className="mt-8 grid gap-px md:grid-cols-3" style={{ background: "var(--le-border)" }}>
                    {orientations.map((o) => {
                      const Icon = o.icon;
                      const sel = selectedOrientation === o.id;
                      const isComingSoon = "comingSoon" in o && o.comingSoon;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => { if (!isComingSoon) setSelectedOrientation(o.id); }}
                          disabled={isComingSoon}
                          className="group flex items-center justify-between p-6 text-left transition-all duration-500 ease-cinematic disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ background: sel ? "var(--le-bg-elev)" : "var(--le-bg)" }}
                        >
                          <div className="flex items-center gap-5">
                            <span
                              className={`flex h-12 w-12 items-center justify-center border ${
                                sel ? "border-foreground text-foreground" : "border-border text-muted-foreground group-hover:border-foreground/40"
                              }`}
                            >
                              <Icon className="h-5 w-5" strokeWidth={1.5} />
                            </span>
                            <div>
                              <div className="text-base font-semibold tracking-[-0.01em]">{o.label}</div>
                              <div className="tabular text-[11px] text-muted-foreground">{o.ratio}</div>
                            </div>
                          </div>
                          {isComingSoon ? (
                            <span className="label text-accent">— Soon</span>
                          ) : (
                            <>
                              {o.extra > 0 && !isLifeCycle && (
                                <span className="tabular text-xs text-muted-foreground">+${o.extra}</span>
                              )}
                              {o.extra > 0 && isLifeCycle && (
                                <span className="label text-accent">— Included</span>
                              )}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              </motion.div>
            )}

            {/* ─── Step 1 — Property ─── */}
            {step === 1 && (
              <motion.div key="step-1" variants={stepFade} initial="hidden" animate="visible" exit="exit" className="space-y-12">
                <section>
                  {/* MLS auto-fill */}
                  <div className="mb-8">
                    {!mlsPanelOpen ? (
                      <button
                        type="button"
                        onClick={() => { setMlsPanelOpen(true); setMlsError(null); }}
                        className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-accent underline underline-offset-4 hover:text-accent/80 transition-colors"
                      >
                        <Search className="h-3.5 w-3.5" />
                        Auto-fill from MLS?
                      </button>
                    ) : (
                      <div className="space-y-3 border border-border p-5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold tracking-[-0.01em]">Fetch from listing</span>
                          <button
                            type="button"
                            onClick={() => { setMlsPanelOpen(false); setMlsError(null); setMlsUrl(""); }}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            aria-label="Close"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <Input
                          value={mlsUrl}
                          onChange={(e) => setMlsUrl(e.target.value)}
                          placeholder="Paste listing URL"
                          onKeyDown={(e) => e.key === "Enter" && handleMlsScrape()}
                          disabled={mlsScraping}
                        />
                        {mlsError && (
                          <p className="text-xs text-red-500">{mlsError}</p>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleMlsScrape}
                          disabled={!mlsUrl.trim() || mlsScraping}
                          className="w-full"
                        >
                          {mlsScraping ? (
                            <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" strokeWidth={1.5} /> Fetching listing details…</>
                          ) : (
                            "Auto-fill"
                          )}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-8">
                    <div>
                      <Label className="label text-muted-foreground">Address</Label>
                      <AddressAutocomplete
                        value={address}
                        onChange={setAddress}
                        placeholder="208 Berry Street, Brooklyn, NY"
                        className="mt-3"
                      />
                    </div>

                    <div className="grid gap-6 md:grid-cols-3">
                      <div>
                        <Label className="label text-muted-foreground">Price</Label>
                        <div className="relative mt-3">
                          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/60">
                            $
                          </span>
                          <Input
                            type="number"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            placeholder="2,400,000"
                            className="tabular pl-7"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="label text-muted-foreground">Bedrooms</Label>
                        <Input
                          type="number"
                          min={0}
                          value={bedrooms}
                          onChange={(e) => setBedrooms(e.target.value)}
                          placeholder="3"
                          className="tabular mt-3"
                        />
                      </div>
                      <div>
                        <Label className="label text-muted-foreground">Bathrooms</Label>
                        <Input
                          type="number"
                          min={0}
                          step={0.5}
                          value={bathrooms}
                          onChange={(e) => setBathrooms(e.target.value)}
                          placeholder="2.5"
                          className="tabular mt-3"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="label text-muted-foreground">Listing agent</Label>
                      <Input
                        value={agent}
                        onChange={(e) => setAgent(e.target.value)}
                        placeholder="Jane Smith"
                        className="mt-3"
                      />
                    </div>

                    {needsDaysOnMarket && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="grid gap-6 md:grid-cols-2"
                      >
                        <div>
                          <Label className="label text-muted-foreground">Days on market</Label>
                          <Input
                            type="number"
                            min={0}
                            value={daysOnMarket}
                            onChange={(e) => setDaysOnMarket(e.target.value)}
                            placeholder="14"
                            className="tabular mt-3"
                          />
                        </div>
                        {needsSoldPrice && (
                          <div>
                            <Label className="label text-muted-foreground">Sold price</Label>
                            <div className="relative mt-3">
                              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/60">
                                $
                              </span>
                              <Input
                                type="number"
                                value={soldPrice}
                                onChange={(e) => setSoldPrice(e.target.value)}
                                placeholder="2,500,000"
                                className="tabular pl-7"
                              />
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                </section>
              </motion.div>
            )}

            {/* ─── Step 2 — Add-ons ─── */}
            {step === 2 && (
              <motion.div key="step-2" variants={stepFade} initial="hidden" animate="visible" exit="exit" className="space-y-12">
                <section>
                  <h2 className="text-xl font-semibold tracking-[-0.01em]">Optional Upgrades</h2>
                  <p className="mt-2 max-w-md text-sm text-muted-foreground">
                    Each add-on is optional. Voice clone and AI voiceover are mutually exclusive — pick one or neither.
                  </p>

                  <div className="mt-10 grid gap-px" style={{ background: "var(--le-border)" }}>
                    {/* AI voiceover */}
                    {(() => {
                      const active = addVoiceover;
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            const next = !addVoiceover;
                            setAddVoiceover(next);
                            if (next) setAddVoiceClone(false);
                            if (!next) {
                              setSelectedVoiceId(null);
                              setCompassUrl("");
                              setVoiceoverPreviewUrl(null);
                              setVoiceoverScript(null);
                              setVoiceoverError(null);
                            }
                          }}
                          className="group flex items-start gap-6 p-6 text-left transition-all duration-500 ease-cinematic"
                          style={{ background: active ? "var(--le-bg-elev)" : "var(--le-bg)" }}
                        >
                          <span
                            className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center border transition-colors duration-500 ${
                              active
                                ? "border-foreground bg-foreground text-background"
                                : "border-border text-muted-foreground group-hover:border-foreground/40"
                            }`}
                          >
                            <Mic className="h-4 w-4" strokeWidth={1.5} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <h3 className="text-base font-semibold tracking-[-0.01em]">AI voiceover</h3>
                              <span className="tabular text-xs text-muted-foreground">+ $15</span>
                            </div>
                            <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
                              Studio-quality narration generated from a script tailored to the listing.
                            </p>
                          </div>
                        </button>
                      );
                    })()}

                    {/* Voice clone — coming soon */}
                    <div
                      className="flex items-start gap-6 p-6 opacity-50 cursor-not-allowed"
                      style={{ background: "var(--le-bg)" }}
                    >
                      <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center border border-border text-muted-foreground">
                        <Mic className="h-4 w-4" strokeWidth={1.5} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <h3 className="text-base font-semibold tracking-[-0.01em]">Voice clone</h3>
                            <span className="label text-accent">— Coming soon</span>
                          </div>
                          <span className="tabular text-xs text-muted-foreground">+ $15</span>
                        </div>
                        <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
                          Use a sample of your own voice. Setup happens after submission.
                        </p>
                      </div>
                    </div>

                    {/* Custom request */}
                    {(() => {
                      const active = addCustomRequest;
                      return (
                        <button
                          type="button"
                          onClick={() => setAddCustomRequest(!addCustomRequest)}
                          className="group flex items-start gap-6 p-6 text-left transition-all duration-500 ease-cinematic"
                          style={{ background: active ? "var(--le-bg-elev)" : "var(--le-bg)" }}
                        >
                          <span
                            className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center border transition-colors duration-500 ${
                              active
                                ? "border-foreground bg-foreground text-background"
                                : "border-border text-muted-foreground group-hover:border-foreground/40"
                            }`}
                          >
                            <Sparkles className="h-4 w-4" strokeWidth={1.5} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <h3 className="text-base font-semibold tracking-[-0.01em]">Custom request</h3>
                              <span className="tabular text-xs text-muted-foreground">+ $15</span>
                            </div>
                            <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
                              Specific shots, music, or pacing notes for the production team.
                            </p>
                          </div>
                        </button>
                      );
                    })()}
                  </div>

                  <AnimatePresence>
                    {addVoiceover && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <div className="mt-6 space-y-6 border border-border p-6">
                          <div>
                            <Label className="label text-muted-foreground">Choose a voice</Label>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                              {VOICE_CATALOG.map((v) => (
                                <button
                                  key={v.id}
                                  type="button"
                                  onClick={() => setSelectedVoiceId(v.id)}
                                  className={`flex flex-col gap-1 border p-4 text-left transition-colors duration-300 ${
                                    selectedVoiceId === v.id
                                      ? "border-foreground bg-foreground/5"
                                      : "border-border hover:border-foreground/30"
                                  }`}
                                >
                                  <span className="text-sm font-semibold tracking-[-0.01em]">{v.name}</span>
                                  <span className="text-xs text-muted-foreground capitalize">{v.gender} · {v.description}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <Label className="label text-muted-foreground">Compass listing URL</Label>
                            <Input
                              value={compassUrl}
                              onChange={(e) => {
                                setCompassUrl(e.target.value);
                                setVoiceoverPreviewUrl(null);
                                setVoiceoverScript(null);
                              }}
                              placeholder="https://www.compass.com/listing/..."
                              className="mt-3"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={
                              !selectedVoiceId ||
                              !selectedDuration ||
                              voiceoverGenerating ||
                              (!voiceoverScript && !compassUrl)
                            }
                            onClick={handleGenerateVoiceover}
                            className="w-full"
                          >
                            {voiceoverGenerating ? (
                              <><Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} /> Generating…</>
                            ) : voiceoverScript && lastUsedVoiceId && selectedVoiceId !== lastUsedVoiceId ? (
                              <><Mic className="mr-2 h-4 w-4" strokeWidth={1.5} /> Try this voice</>
                            ) : (
                              <><Mic className="mr-2 h-4 w-4" strokeWidth={1.5} /> Generate voiceover</>
                            )}
                          </Button>
                          {voiceoverGenerating && voiceoverStage && (
                            <div className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 px-4 py-3">
                              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" strokeWidth={1.5} />
                              <span className="text-sm text-foreground">{voiceoverStage}</span>
                            </div>
                          )}
                          {voiceoverError && (
                            <p className="text-xs text-red-500">{voiceoverError}</p>
                          )}
                          {voiceoverPreviewUrl && voiceoverScript && (
                            <div className="space-y-4">
                              <audio controls src={voiceoverPreviewUrl} className="w-full" />
                              <blockquote className="border-l-2 border-border pl-4 text-sm leading-relaxed text-muted-foreground italic">
                                {voiceoverScript}
                              </blockquote>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setVoiceoverPreviewUrl(null);
                                  setVoiceoverScript(null);
                                  setLastUsedVoiceId(null);
                                }}
                                className="text-xs text-muted-foreground"
                              >
                                <RotateCcw className="mr-1.5 h-3 w-3" strokeWidth={1.5} />
                                Regenerate
                              </Button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {addCustomRequest && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <div className="mt-6">
                          <Label className="label text-muted-foreground">Custom notes</Label>
                          <textarea
                            value={customRequestText}
                            onChange={(e) => setCustomRequestText(e.target.value)}
                            placeholder="Specific shots, music style, pacing preferences, brand language…"
                            rows={5}
                            className="mt-3 flex min-h-[120px] w-full rounded-none border border-border bg-transparent px-4 py-3 text-sm transition-colors placeholder:text-muted-foreground/60 focus-visible:border-accent focus-visible:outline-none"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
              </motion.div>
            )}

            {/* ─── Step 3 — Photos ─── */}
            {step === 3 && (
              <motion.div key="step-3" variants={stepFade} initial="hidden" animate="visible" exit="exit" className="space-y-10">
                <section>
                  <div className="flex items-baseline justify-between">
                    <div>
                      <p className="max-w-md text-sm text-muted-foreground">
                        Drop or browse 10 to 60 high-resolution images. JPG, PNG, HEIC, or WebP.
                      </p>
                    </div>
                    {files.length > 0 && (
                      <div className="text-right">
                        <span className="tabular block text-2xl font-semibold tracking-[-0.02em]">{files.length}</span>
                        <span className="label text-muted-foreground">{formatSize(totalSize)}</span>
                      </div>
                    )}
                  </div>

                  {/* Drop zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      handleFiles(e.dataTransfer.files);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className="relative mt-10 flex aspect-[16/7] cursor-pointer items-center justify-center border-2 border-dashed text-center transition-all duration-500 ease-cinematic"
                    style={{ borderColor: isDragging ? "var(--le-text)" : "var(--le-border-strong)", background: isDragging ? "var(--le-bg-sunken)" : "var(--le-bg-elev)" }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.heic,.webp"
                      className="hidden"
                      onChange={(e) => e.target.files && handleFiles(e.target.files)}
                    />
                    <input
                      ref={folderInputRef}
                      type="file"
                      {...({ webkitdirectory: "", directory: "" } as React.HTMLAttributes<HTMLInputElement>)}
                      className="hidden"
                      onChange={(e) => e.target.files && handleFiles(e.target.files)}
                    />
                    <div>
                      <Camera className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
                      <p className="mt-5 text-base font-semibold tracking-[-0.01em]">Drop photos to upload</p>
                      <p className="mt-1 text-xs text-muted-foreground">or click to browse files</p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          folderInputRef.current?.click();
                        }}
                        className="mt-6 text-[11px] font-medium uppercase tracking-[0.15em] text-accent underline underline-offset-4 hover:text-accent/80"
                      >
                        Or import an entire folder
                      </button>
                    </div>
                  </div>

                  {/* Progress */}
                  {files.length > 0 && files.length < 10 && (
                    <div className="mt-6 flex items-center gap-4">
                      <div className="h-px flex-1 overflow-hidden bg-border">
                        <motion.div
                          className="h-full bg-foreground"
                          animate={{ width: `${(files.length / 10) * 100}%` }}
                          transition={{ duration: 0.5, ease: EASE }}
                        />
                      </div>
                      <span className="tabular label text-accent">{10 - files.length} more required</span>
                    </div>
                  )}

                  {/* Thumbnails */}
                  {files.length > 0 && (
                    <div className="mt-8 grid grid-cols-4 gap-1 sm:grid-cols-6 md:grid-cols-8">
                      <AnimatePresence>
                        {files.map((f) => (
                          <motion.div
                            key={f.id}
                            initial={{ opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.85 }}
                            transition={{ duration: 0.4, ease: EASE }}
                            className="group relative aspect-square overflow-hidden bg-secondary"
                          >
                            <img src={f.preview} alt="" className="h-full w-full object-cover" />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFile(f.id);
                              }}
                              className="absolute inset-0 flex items-center justify-center bg-black/70 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                              aria-label="Remove photo"
                            >
                              <X className="h-3.5 w-3.5 text-white" />
                            </button>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </section>

                {submitError && (
                  <div className="border border-destructive/40 bg-destructive/10 p-5">
                    <p className="text-xs text-destructive">{submitError}</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Sticky footer */}
      <div className="sticky bottom-0 z-30 backdrop-blur-xl" style={{ borderTop: "1px solid var(--le-border)", background: "var(--le-bg)" }}>
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-6 px-8 py-5 md:px-12">
          <div className="flex items-center gap-8">
            <div>
              <span style={{ fontFamily: "var(--le-font-sans)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase" as const, color: "var(--le-text-muted)" }}>Total</span>
              <div style={{ fontFamily: "var(--le-font-sans)", fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--le-text)" }}>${totalPrice}</div>
            </div>
            {step === 0 && step0Valid && (
              <button
                type="button"
                onClick={() => setShowSavePreset(true)}
                className="hidden items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground md:flex"
              >
                <Bookmark className="h-3.5 w-3.5" /> Save as preset
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {step > 0 && (
              <button
                type="button"
                onClick={back}
                disabled={submitting}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "transparent", color: submitting ? "var(--le-text-faint)" : "var(--le-text)",
                  border: "1px solid var(--le-border-strong)", borderRadius: 4,
                  padding: "10px 16px", fontSize: 13, fontWeight: 500,
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                <ArrowLeft style={{ width: 14, height: 14 }} /> Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={next}
                disabled={!canAdvance}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: !canAdvance ? "var(--le-border-strong)" : "var(--le-accent)",
                  color: "var(--le-accent-fg)", border: "none", borderRadius: 4,
                  padding: "10px 20px", fontSize: 13, fontWeight: 500,
                  cursor: !canAdvance ? "not-allowed" : "pointer",
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                Continue <ArrowRight style={{ width: 14, height: 14 }} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: !canSubmit || submitting ? "var(--le-border-strong)" : "var(--le-accent)",
                  color: "var(--le-accent-fg)", border: "none", borderRadius: 4,
                  padding: "12px 24px", fontSize: 14, fontWeight: 500,
                  cursor: !canSubmit || submitting ? "not-allowed" : "pointer",
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                {submitting ? (
                  <><Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} />
                  {uploadProgress ? `${uploadProgress.uploaded} / ${uploadProgress.total}` : "Submitting…"}</>
                ) : (
                  <>Generate video <ArrowRight style={{ width: 16, height: 16 }} /></>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Save preset dialog */}
      <Dialog open={showSavePreset} onOpenChange={setShowSavePreset}>
        <DialogContent className="max-w-sm rounded-none">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold tracking-[-0.01em]">
              {presetSaved ? "Saved." : "Save as preset"}
            </DialogTitle>
          </DialogHeader>
          {presetSaved ? (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="flex h-12 w-12 items-center justify-center border border-accent/40 bg-accent/10 text-accent">
                <CheckCircle2 className="h-5 w-5" strokeWidth={1.5} />
              </div>
            </div>
          ) : (
            <>
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="My weekday listings"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleSavePreset()}
              />
              <DialogFooter>
                <Button onClick={handleSavePreset} disabled={!presetName.trim()}>
                  Save preset
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Upload;
