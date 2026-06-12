import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  Check,
  Search,
  Image,
  Clock,
  Box,
  User,
} from "lucide-react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPresets, savePreset, type Preset } from "@/lib/presets";
import { createProperty, generateVoiceoverPreview, lookupMls } from "@/lib/api";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { digitsOnly, formatNumber } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useLoginDialog } from "@/v2/components/auth/LoginDialogContext";
import { Link } from "react-router-dom";
import { Menu } from "lucide-react";
import { DashboardSidebar, useDashboardSidebar } from "@/components/DashboardSidebar";
import { Icon } from "@/components/dashboard/icons";
import { useMediaQuery } from "@/hooks/use-mobile";
import "@/v2/styles/v2.css";
import "@/v3/styles/glass.css";

// Voice catalog for the AI voiceover panel — kept in sync with lib/voiceover/voices.ts
const VOICE_CATALOG = [
  {
    id: "UgBBYS2sOqTuMpoF3BR0",
    name: "Mark",
    gender: "Male" as const,
    description: "Natural, conversational",
  },
  {
    id: "dtSEyYGNJqjrtBArPCVZ",
    name: "Jack",
    gender: "Male" as const,
    description: "Deep, commanding narrator",
  },
  {
    id: "F7hCTbeEDbm7osolS21j",
    name: "Amanda",
    gender: "Female" as const,
    description: "Warm, polished, informative",
  },
  {
    id: "kdmDKE6EkgrWrrykO9Qt",
    name: "Jessica",
    gender: "Female" as const,
    description: "Young, conversational, natural",
  },
];

interface UploadedFile {
  file: File;
  preview: string;
  id: string;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const stepFade: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE },
  },
  exit: { opacity: 0, y: -12, transition: { duration: 0.35, ease: EASE } },
};

// Step order: Style → Property → Add-ons → Photos
const STEPS = [
  { label: "Style", sub: "Type · duration · format" },
  { label: "Property", sub: "Address & details" },
  { label: "Add-ons", sub: "Voiceover · custom requests" },
  { label: "Photos", sub: "10–60 high-resolution" },
] as const;

type StepId = 0 | 1 | 2 | 3;

// ─────────────────────────────────────────────────────────────────────────────
// Primitive components
// ─────────────────────────────────────────────────────────────────────────────

interface SectionCardProps {
  label?: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}

function SectionCard({ label, title, sub, right, children }: SectionCardProps) {
  return (
    <section className="g-section-card">
      <div className="g-section-head">
        <div>
          {label && <span className="g-label" style={{ fontSize: 12 }}>{label}</span>}
          <h2 className="g-section-title">{title}</h2>
          {sub && <p className="g-section-sub">{sub}</p>}
        </div>
        {right}
      </div>
      <div className="g-section-body">{children}</div>
    </section>
  );
}

interface FieldProps {
  label: string;
  full?: boolean;
  half?: boolean;
  children: React.ReactNode;
}

function Field({ label, full, half, children }: FieldProps) {
  return (
    <div className={`g-form-field${full ? " full" : ""}${half ? " half" : ""}`}>
      <label className="g-form-label">{label}</label>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard app-shell frame
//
// WS6: the /upload wizard renders through the same L2 chrome the rest of the
// authed app uses (DashboardSidebar + le-dash-shell), instead of the standalone
// marketing glass-page + SiteNav. This is a chrome-only wrapper — the wizard
// step content, state, and the createProperty→Stripe revenue path are untouched.
// The route stays standalone (/upload, outside the <Dashboard> Outlet) so the
// public Stripe redirect targets /upload/success and /upload/cancelled are
// unaffected; we replicate the shell here rather than moving the route.
// ─────────────────────────────────────────────────────────────────────────────

function ShellFrame({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useDashboardSidebar();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 1024px)");

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  return (
    <div
      className={`le-root le-dash-shell${collapsed ? " is-collapsed" : ""}${
        drawerOpen ? " is-drawer-open" : ""
      }`}
    >
      <DashboardSidebar
        collapsed={isMobile ? false : collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />
      <div
        className="le-dash-backdrop"
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <div className="le-dash-main">
        <div className="le-dash-mobilebar">
          <button
            type="button"
            className="le-dash-hamburger"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu size={20} strokeWidth={1.8} />
          </button>
          <Link to="/dashboard" className="le-dash-mobilebar-brand">
            <Icon name="logo" size={22} />
            Listing Elevate
          </Link>
        </div>
        <main className="le-main-scroll">{children}</main>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const Upload = () => {
  // ─── auth ───
  const { user, profile, loading: authLoading } = useAuth();
  const { openLogin } = useLoginDialog();

  // ─── form state ───
  const [step, setStep] = useState<StepId>(0);
  const [address, setAddress] = useState("");
  const [price, setPrice] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [sqft, setSqft] = useState("");
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
  const [pipelineMode, setPipelineMode] = useState<'v1' | 'v1.1'>('v1');

  // ─── voiceover panel state ───
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [compassUrl, setCompassUrl] = useState("");
  const [voiceoverGenerating, setVoiceoverGenerating] = useState(false);
  const [voiceoverError, setVoiceoverError] = useState<string | null>(null);
  const [voiceoverPreviewUrl, setVoiceoverPreviewUrl] = useState<string | null>(null);
  const [voiceoverScript, setVoiceoverScript] = useState<string | null>(null);
  const [voiceoverStage, setVoiceoverStage] = useState<string | null>(null);
  const [lastUsedVoiceId, setLastUsedVoiceId] = useState<string | null>(null);

  // ─── MLS lookup state ───
  const [mlsLookingUp, setMlsLookingUp] = useState(false);
  const [mlsError, setMlsError] = useState<string | null>(null);
  const [mlsFilled, setMlsFilled] = useState(false);
  const [compassDescription, setCompassDescription] = useState<string | null>(null);

  // ─── flow state ───
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [trackingId, setTrackingId] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    uploaded: number;
    total: number;
  } | null>(null);

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

  // ─── MLS lookup by address ───
  const handleMlsLookup = async () => {
    if (!address.trim()) return;
    setMlsLookingUp(true);
    setMlsError(null);
    setMlsFilled(false);
    try {
      const r = await lookupMls(address.trim());
      if (r.price != null) setPrice(String(r.price));
      if (r.bedrooms != null) setBedrooms(String(r.bedrooms));
      if (r.bathrooms != null) setBathrooms(String(r.bathrooms));
      if (r.sqft != null) setSqft(String(r.sqft));
      if (r.agent) setAgent(r.agent);
      if (r.description) setCompassDescription(r.description);
      setMlsFilled(true);
    } catch (e) {
      setMlsError(
        e instanceof Error
          ? e.message
          : "Couldn't find this address on MLS — fill in details manually.",
      );
    } finally {
      setMlsLookingUp(false);
    }
  };

  const handleMlsReset = () => {
    setPrice("");
    setBedrooms("");
    setBathrooms("");
    setSqft("");
    setAgent("");
    setCompassDescription(null);
    setMlsFilled(false);
    setMlsError(null);
  };

  // ─── catalog ───
  const packages = [
    { id: "just_listed", name: "Just Listed", desc: "New to market", Icon: Home },
    { id: "just_pended", name: "Just Pended", desc: "Under contract", Icon: Flame },
    { id: "just_closed", name: "Just Closed", desc: "Successful close", Icon: Trophy },
    {
      id: "life_cycle",
      name: "Life Cycle",
      desc: "Three-video series",
      Icon: Layers,
      badge: "Best value",
    },
  ];

  const durations = [
    { id: "15s", label: "15", price: 75, lifeCyclePrice: 90 },
    { id: "30s", label: "30", price: 125, lifeCyclePrice: 140 },
    { id: "60s", label: "60", price: 175, lifeCyclePrice: 190 },
  ];

  // Horizontal is primary; vertical and both are coming soon.
  const orientations = [
    {
      id: "horizontal",
      label: "Horizontal",
      ratio: "16:9",
      Icon: RectangleHorizontal,
      extra: 0,
    },
    {
      id: "vertical",
      label: "Vertical",
      ratio: "9:16",
      Icon: RectangleVertical,
      extra: 0,
      comingSoon: true,
    },
    {
      id: "both",
      label: "Both",
      ratio: "9:16 + 16:9",
      Icon: Square,
      extra: 10,
      comingSoon: true,
    },
  ];

  const selectedDur = durations.find((d) => d.id === selectedDuration);
  const isLifeCycle = selectedPackage === "life_cycle";
  const basePrice = selectedDur
    ? isLifeCycle
      ? selectedDur.lifeCyclePrice
      : selectedDur.price
    : 0;
  const orientationExtra = isLifeCycle
    ? 0
    : orientations.find((o) => o.id === selectedOrientation)?.extra || 0;
  const voiceoverExtra = addVoiceover ? 10 : 0;
  const customExtra = addCustomRequest ? 15 : 0;
  const VOICE_CLONE_SETUP = 125;
  const VOICE_CLONE_PER_VIDEO = 10;
  const hasExistingClone =
    profile?.voice_clone_status === "ready" || !!profile?.elevenlabs_voice_id;
  const voiceCloneExtra = addVoiceClone
    ? hasExistingClone
      ? VOICE_CLONE_PER_VIDEO
      : VOICE_CLONE_SETUP + VOICE_CLONE_PER_VIDEO
    : 0;
  const totalPrice =
    basePrice + orientationExtra + voiceoverExtra + customExtra + voiceCloneExtra;

  const needsDaysOnMarket =
    selectedPackage === "just_pended" || selectedPackage === "just_closed";
  const needsSoldPrice = selectedPackage === "just_closed";

  // ─── per-step validity (0=Style, 1=Property, 2=Add-ons, 3=Photos) ───
  const step0Valid = !!(selectedPackage && selectedDuration && selectedOrientation);
  const step1Valid = !!(
    address &&
    price &&
    bedrooms &&
    bathrooms &&
    sqft &&
    agent &&
    (!needsDaysOnMarket || daysOnMarket) &&
    (!needsSoldPrice || soldPrice)
  );
  const step2Valid = !addCustomRequest || customRequestText.trim().length > 0;
  const step3Valid = files.length >= 10;
  const stepValidity = [step0Valid, step1Valid, step2Valid, step3Valid] as const;
  const canAdvance = stepValidity[step];
  const canSubmit = stepValidity.every(Boolean) && !!user;

  // Auto-select horizontal orientation (only available option for now)
  useEffect(() => {
    if (!selectedOrientation) setSelectedOrientation("horizontal");
  }, [selectedOrientation]);

  // ─── files ───
  const handleFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const accepted = Array.from(newFiles).filter((f) =>
        /\.(jpg|jpeg|png|heic|webp)$/i.test(f.name),
      );
      const remaining = 60 - files.length;
      const toAdd = accepted.slice(0, remaining);
      const mapped = toAdd.map((f) => ({
        file: f,
        preview: URL.createObjectURL(f),
        id: crypto.randomUUID(),
      }));
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
    bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  // ─── voiceover generation ───
  const handleGenerateVoiceover = async () => {
    if (!selectedVoiceId || !selectedDuration) return;
    const isVoiceOnlyRerender =
      !!voiceoverScript &&
      !!voiceoverPreviewUrl &&
      !!lastUsedVoiceId &&
      selectedVoiceId !== lastUsedVoiceId;

    if (!isVoiceOnlyRerender && !compassDescription && !compassUrl) return;

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
      setVoiceoverStage(
        compassDescription ? "Writing your script…" : "Reading your listing…",
      );
      const t1 = setTimeout(
        () => setVoiceoverStage("Writing your script…"),
        compassDescription ? 0 : 12_000,
      );
      const t2 = setTimeout(
        () => setVoiceoverStage("Recording the voiceover…"),
        compassDescription ? 10_000 : 22_000,
      );
      const t3 = setTimeout(
        () => setVoiceoverStage("Almost done…"),
        compassDescription ? 25_000 : 38_000,
      );
      clearStages = () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }

    try {
      const result = await generateVoiceoverPreview({
        voiceId: selectedVoiceId,
        durationSec,
        ...(isVoiceOnlyRerender
          ? { compassUrl, script: voiceoverScript! }
          : compassDescription
            ? { description: compassDescription, compassUrl: undefined }
            : { compassUrl }),
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
          sqft: sqft ? Number(sqft) : undefined,
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
          pipelineMode,
        },
        (uploaded, total) => setUploadProgress({ uploaded, total }),
      );
      // Owner-bypass path: server already marked the property paid and fired
      // the pipeline. Skip Stripe and go straight to the success page.
      if (result.bypassed) {
        window.location.href = `/upload/success?property_id=${result.property.id}&bypass=1`;
        return;
      }
      // Redirect to Stripe Checkout. success_url lands at /upload/success.
      if (!result.checkoutUrl) {
        throw new Error("Server did not return a checkout URL");
      }
      window.location.href = result.checkoutUrl;
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to submit property",
      );
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
      <ShellFrame>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "96px 24px",
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE }}
            style={{ width: "100%", maxWidth: 420, textAlign: "center" }}
          >
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, duration: 0.8, ease: EASE }}
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: "rgba(47, 138, 85, 0.1)",
                border: "1px solid rgba(47, 138, 85, 0.3)",
                display: "grid",
                placeItems: "center",
                margin: "0 auto 36px",
                color: "var(--good)",
              }}
            >
              <CheckCircle2 size={32} strokeWidth={1.5} />
            </motion.div>
            <p className="g-label" style={{ marginBottom: 12 }}>In production</p>
            <h1
              style={{
                margin: 0,
                fontSize: 40,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                color: "var(--ink)",
                lineHeight: 1.1,
              }}
            >
              Your video
              <br />
              is in motion.
            </h1>
            <p
              style={{
                marginTop: 20,
                fontSize: 14,
                color: "var(--muted)",
                lineHeight: 1.6,
              }}
            >
              {files.length} photos received. Estimated delivery in 72 hours.
              We'll email you when it's ready.
            </p>
            <div
              className="g-order-card"
              style={{ marginTop: 36, textAlign: "left" }}
            >
              <div className="g-order-lines">
                <div className="g-order-line">
                  <div className="g-order-line-label">Tracking</div>
                  <div className="g-order-line-val g-tabular">
                    {trackingId.slice(0, 8)}
                  </div>
                </div>
                <div className="g-order-line">
                  <div className="g-order-line-label">Total</div>
                  <div className="g-order-line-val g-tabular">${totalPrice.toLocaleString()}</div>
                </div>
              </div>
            </div>
            <button
              className="g-cta-primary"
              style={{ width: "100%", marginTop: 20, justifyContent: "center" }}
              onClick={() => navigate(`/status/${trackingId}`)}
            >
              Track production <ArrowRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                fontSize: 12,
                color: "var(--muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Submit another listing
            </button>
          </motion.div>
        </div>
      </ShellFrame>
    );
  }

  // ─── derived label helpers ───
  const selectedPkgName =
    packages.find((p) => p.id === selectedPackage)?.name ?? "";
  const selectedOriLabel =
    orientations.find((o) => o.id === selectedOrientation)?.label ?? "";

  // ─── main render ───
  return (
    <ShellFrame>
      {/* Content wrapper — shell provides the gutter/scroll (DESIGN-GUIDE §9) */}
      <div style={{ position: "relative", flex: 1 }}>
        {/* Page heading */}
        <div style={{ paddingTop: 12 }}>
          <div className="g-page-heading">
            <div>
              <span className="g-page-eyebrow">
                Step {step + 1} of 4 — {STEPS[step].label}
              </span>
              <h1 className="g-page-h1">New listing</h1>
              <p className="g-page-sub">
                Configure the video, attach property details, and upload photos.
                The pipeline picks up automatically the moment you submit.
              </p>
            </div>
            <div className="g-page-actions">
              {hasPresets && (
                <button
                  type="button"
                  className="g-btn-ghost"
                  onClick={handleUseLastPreset}
                >
                  <RotateCcw size={13} /> Use last preset
                </button>
              )}
              {step === 0 && step0Valid && (
                <button
                  type="button"
                  className="g-btn-ghost"
                  onClick={() => setShowSavePreset(true)}
                >
                  <Bookmark size={13} /> Save preset
                </button>
              )}
            </div>
          </div>

          {/* Step rail */}
          <div className="g-step-rail">
            {STEPS.map((s, i) => {
              const active = i === step;
              const done = i < step;
              const reachable =
                i <= step || stepValidity.slice(0, i).every(Boolean);
              return (
                <button
                  key={s.label}
                  type="button"
                  className={`g-step-pip${active ? " active" : ""}${done ? " done" : ""}`}
                  disabled={!reachable}
                  onClick={() => {
                    if (reachable) setStep(i as StepId);
                  }}
                >
                  <div className="g-step-pip-num">
                    {done ? (
                      <Check size={12} strokeWidth={2.2} />
                    ) : (
                      <span>{String(i + 1).padStart(2, "0")}</span>
                    )}
                  </div>
                  <div className="g-step-pip-meta">
                    <div className="g-step-pip-label">{s.label}</div>
                    <div className="g-step-pip-sub">{s.sub}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Two-pane layout */}
        <div style={{ padding: "0 0 48px" }}>
          <div className="g-upload-layout">
            {/* Left: step content */}
            <div className="g-upload-main">
              <AnimatePresence mode="wait">
                {/* ─── Step 0 — Style ─── */}
                {step === 0 && (
                  <motion.div
                    key="step-0"
                    variants={stepFade}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    style={{ display: "flex", flexDirection: "column", gap: 16 }}
                  >
                    {/* Video type */}
                    <SectionCard
                      label="Video type"
                      title="What's the moment?"
                      sub="Picks the script template, beat structure, and pacing recipe."
                    >
                      <div className="g-card-grid-2">
                        {packages.map((pkg) => {
                          const sel = selectedPackage === pkg.id;
                          return (
                            <button
                              key={pkg.id}
                              type="button"
                              className={`g-choice-card${sel ? " selected" : ""}`}
                              onClick={() => setSelectedPackage(pkg.id)}
                            >
                              <span className={`g-choice-icon${sel ? " on" : ""}`}>
                                <pkg.Icon size={16} strokeWidth={sel ? 1.9 : 1.6} />
                              </span>
                              <div className="g-choice-meta">
                                <div className="g-choice-title-row">
                                  <span className="g-choice-title">{pkg.name}</span>
                                  {pkg.badge && (
                                    <span className="g-choice-badge">{pkg.badge}</span>
                                  )}
                                </div>
                                <div className="g-choice-sub">{pkg.desc}</div>
                              </div>
                              <span className={`g-choice-check${sel ? " on" : ""}`}>
                                {sel && <Check size={12} strokeWidth={2.4} />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </SectionCard>

                    {/* Duration */}
                    <SectionCard
                      label="Duration"
                      title="How long should it run?"
                      sub={
                        isLifeCycle
                          ? "Life Cycle bundles three videos at the chosen length."
                          : "Pricing scales with run-time."
                      }
                    >
                      <div className="g-card-grid-3">
                        {durations.map((d) => {
                          const sel = selectedDuration === d.id;
                          const p = isLifeCycle ? d.lifeCyclePrice : d.price;
                          return (
                            <button
                              key={d.id}
                              type="button"
                              className={`g-duration-tile${sel ? " selected" : ""}`}
                              onClick={() => setSelectedDuration(d.id)}
                            >
                              <div className="g-duration-num">
                                <span className="g-duration-val">{d.label}</span>
                                <span className="g-duration-unit">sec</span>
                              </div>
                              <div className="g-duration-foot">
                                <span className="g-tabular">${p}</span>
                                {isLifeCycle && (
                                  <span className="g-duration-save">Saves $25</span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </SectionCard>

                    {/* Orientation / format */}
                    <SectionCard label="Format" title="Aspect ratio">
                      <div className="g-card-grid-3">
                        {orientations.map((o) => {
                          const sel = selectedOrientation === o.id;
                          const isComingSoon = "comingSoon" in o && o.comingSoon;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              className={`g-orient-tile${sel ? " selected" : ""}${isComingSoon ? " soon" : ""}`}
                              disabled={isComingSoon}
                              onClick={() => {
                                if (!isComingSoon) setSelectedOrientation(o.id);
                              }}
                            >
                              <div className={`g-orient-glyph ${o.id}`} />
                              <div className="g-orient-meta">
                                <div className="g-orient-label">{o.label}</div>
                                <div className="g-orient-ratio">{o.ratio}</div>
                              </div>
                              {isComingSoon ? (
                                <span className="g-orient-soon">Soon</span>
                              ) : o.extra > 0 && !isLifeCycle ? (
                                <span className="g-orient-extra g-tabular">
                                  +${o.extra}
                                </span>
                              ) : sel ? (
                                <span className="g-orient-check">
                                  <Check size={12} strokeWidth={2.2} />
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </SectionCard>
                  </motion.div>
                )}

                {/* ─── Step 1 — Property ─── */}
                {step === 1 && (
                  <motion.div
                    key="step-1"
                    variants={stepFade}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                  >
                    <SectionCard
                      label="Property"
                      title="Listing details"
                      sub="Auto-fills from MLS when the address resolves."
                    >
                      <div className="g-form-grid">
                        {/* Address */}
                        <Field label="Address" full>
                          <div className="g-input-wrap">
                            <AddressAutocomplete
                              value={address}
                              onChange={(val) => {
                                setAddress(val);
                                if (mlsFilled) handleMlsReset();
                              }}
                              placeholder="208 Berry Street, Brooklyn, NY 11211"
                            />
                          </div>
                          {address.trim().length >= 5 && (
                            <div className="g-mls-trigger">
                              {mlsFilled ? (
                                <span className="g-mls-success">
                                  <Check size={12} strokeWidth={2.4} />
                                  Found on MLS
                                  <button
                                    type="button"
                                    className="g-mls-reset"
                                    onClick={handleMlsReset}
                                  >
                                    reset
                                  </button>
                                </span>
                              ) : mlsLookingUp ? (
                                <span className="g-mls-loading">
                                  <span className="g-mls-spinner" />
                                  Searching MLS — this can take 1–3 minutes…
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="g-mls-btn"
                                  onClick={handleMlsLookup}
                                  disabled={mlsLookingUp}
                                >
                                  <Search size={12} />
                                  Find on MLS
                                </button>
                              )}
                              {mlsError && !mlsLookingUp && (
                                <span className="g-mls-error">{mlsError}</span>
                              )}
                            </div>
                          )}
                        </Field>

                        {/* Numeric fields */}
                        <Field label="List price">
                          <div className="g-input-wrap">
                            <span className="g-input-leading-sym">$</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={price ? formatNumber(Number(price)) : ""}
                              onChange={(e) => setPrice(digitsOnly(e.target.value))}
                              placeholder="2,400,000"
                              className="g-input g-tabular has-leading"
                            />
                          </div>
                        </Field>

                        <Field label="Bedrooms">
                          <input
                            type="number"
                            min={0}
                            value={bedrooms}
                            onChange={(e) => setBedrooms(e.target.value)}
                            placeholder="3"
                            className="g-input g-tabular"
                          />
                        </Field>

                        <Field label="Bathrooms">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={bathrooms}
                            onChange={(e) => setBathrooms(e.target.value)}
                            placeholder="2.5"
                            className="g-input g-tabular"
                          />
                        </Field>

                        <Field label="Square feet">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={sqft ? formatNumber(Number(sqft)) : ""}
                            onChange={(e) => setSqft(digitsOnly(e.target.value))}
                            placeholder="1,850"
                            className="g-input g-tabular"
                          />
                        </Field>

                        <Field label="Listing agent" full>
                          <input
                            value={agent}
                            onChange={(e) => setAgent(e.target.value)}
                            placeholder="Jane Smith"
                            className="g-input"
                          />
                        </Field>

                        {needsDaysOnMarket && (
                          <Field label="Days on market">
                            <input
                              type="number"
                              min={0}
                              value={daysOnMarket}
                              onChange={(e) => setDaysOnMarket(e.target.value)}
                              placeholder="14"
                              className="g-input g-tabular"
                            />
                          </Field>
                        )}

                        {needsSoldPrice && (
                          <Field label="Sold price">
                            <div className="g-input-wrap">
                              <span className="g-input-leading-sym">$</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={soldPrice ? formatNumber(Number(soldPrice)) : ""}
                                onChange={(e) => setSoldPrice(digitsOnly(e.target.value))}
                                placeholder="2,500,000"
                                className="g-input g-tabular has-leading"
                              />
                            </div>
                          </Field>
                        )}

                        {/* v1.1 — Seedance push-in pipeline toggle */}
                        <Field label="Pipeline" full>
                          <RadioGroup
                            value={pipelineMode}
                            onValueChange={(v) => setPipelineMode(v as 'v1' | 'v1.1')}
                            className="mt-2 space-y-0"
                            style={{ gap: 0 }}
                          >
                            <label
                              htmlFor="pipeline-v1"
                              className="flex cursor-pointer items-start gap-4 border border-border p-5 transition-colors duration-300 hover:bg-[var(--le-bg-elev)]"
                              style={{ background: pipelineMode === 'v1' ? 'var(--le-bg-elev)' : 'var(--le-bg)', marginBottom: 1 }}
                            >
                              <RadioGroupItem id="pipeline-v1" value="v1" className="mt-0.5 shrink-0" />
                              <div>
                                <span
                                  className="block text-sm font-medium tracking-[-0.01em]"
                                  style={{ fontFamily: 'var(--le-font-sans)', color: 'var(--le-text)' }}
                                >
                                  Default (v1)
                                </span>
                                <span
                                  className="mt-1 block text-xs leading-relaxed"
                                  style={{ fontFamily: 'var(--le-font-sans)', color: 'var(--le-text-muted)' }}
                                >
                                  Mixed-movement routing across Kling, Runway, and Atlas.
                                </span>
                              </div>
                            </label>

                            <label
                              htmlFor="pipeline-v1-1"
                              className="flex cursor-pointer items-start gap-4 border border-border p-5 transition-colors duration-300 hover:bg-[var(--le-bg-elev)]"
                              style={{ background: pipelineMode === 'v1.1' ? 'var(--le-bg-elev)' : 'var(--le-bg)' }}
                            >
                              <RadioGroupItem id="pipeline-v1-1" value="v1.1" className="mt-0.5 shrink-0" />
                              <div>
                                <span
                                  className="block text-sm font-medium tracking-[-0.01em]"
                                  style={{ fontFamily: 'var(--le-font-sans)', color: 'var(--le-text)' }}
                                >
                                  Experimental v1.1 — Seedance push-in
                                </span>
                                <span
                                  className="mt-1 block text-xs leading-relaxed"
                                  style={{ fontFamily: 'var(--le-font-sans)', color: 'var(--le-text-muted)' }}
                                >
                                  Every clip is a slow push-in with a subtle slow-in / slow-out polish. Paired scenes still use Kling 2.1 start+end-frame.
                                </span>
                              </div>
                            </label>
                          </RadioGroup>
                        </Field>
                      </div>
                    </SectionCard>
                  </motion.div>
                )}

                {/* ─── Step 2 — Add-ons ─── */}
                {step === 2 && (
                  <motion.div
                    key="step-2"
                    variants={stepFade}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                  >
                    <SectionCard
                      label="Add-ons"
                      title="Optional upgrades"
                      sub="Voice clone and AI voiceover are mutually exclusive — pick one or neither."
                    >
                      <div className="g-addons-stack">
                        {/* AI voiceover */}
                        <div
                          className={`g-addon-row${addVoiceover ? " active" : ""}`}
                        >
                          <button
                            type="button"
                            className="g-addon-head"
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
                          >
                            <span
                              className={`g-addon-icon${addVoiceover ? " on" : ""}`}
                            >
                              <Mic size={14} strokeWidth={1.6} />
                            </span>
                            <div className="g-addon-meta">
                              <div className="g-addon-title-row">
                                <span className="g-addon-title">AI voiceover</span>
                                <span className="g-addon-price">+ $10 / video</span>
                              </div>
                              <p className="g-addon-desc">
                                Studio-quality narration generated from a script
                                tailored to the listing.
                              </p>
                            </div>
                            <span
                              className={`g-addon-switch${addVoiceover ? " on" : ""}`}
                            >
                              <span className="g-addon-switch-knob" />
                            </span>
                          </button>

                          <AnimatePresence>
                            {addVoiceover && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.4, ease: EASE }}
                                style={{ overflow: "hidden" }}
                              >
                                <div className="g-addon-body">
                                  {/* Voice picker */}
                                  <div className="g-voice-grid">
                                    {VOICE_CATALOG.map((v) => {
                                      const sel = selectedVoiceId === v.id;
                                      return (
                                        <button
                                          key={v.id}
                                          type="button"
                                          className={`g-voice-tile${sel ? " selected" : ""}`}
                                          onClick={() => setSelectedVoiceId(v.id)}
                                        >
                                          <div className="g-voice-tile-head">
                                            <span className="g-voice-name">
                                              {v.name}
                                            </span>
                                            <span className="g-voice-gender">
                                              {v.gender}
                                            </span>
                                          </div>
                                          <div className="g-voice-desc">
                                            {v.description}
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>

                                  {/* Compass URL or MLS cached notice */}
                                  {compassDescription ? (
                                    <div className="g-mls-cached-notice">
                                      <Check size={12} strokeWidth={2.4} />
                                      Using listing details from MLS
                                    </div>
                                  ) : (
                                    <Field
                                      label="Compass listing URL"
                                      full
                                    >
                                      <input
                                        value={compassUrl}
                                        onChange={(e) => {
                                          setCompassUrl(e.target.value);
                                          setVoiceoverPreviewUrl(null);
                                          setVoiceoverScript(null);
                                        }}
                                        placeholder="https://www.compass.com/listing/..."
                                        className="g-input"
                                        style={{ marginTop: 8 }}
                                      />
                                    </Field>
                                  )}

                                  {/* Generate button */}
                                  <button
                                    type="button"
                                    className="g-cta-primary"
                                    style={{
                                      marginTop: 14,
                                      width: "100%",
                                      justifyContent: "center",
                                    }}
                                    disabled={
                                      !selectedVoiceId ||
                                      !selectedDuration ||
                                      voiceoverGenerating ||
                                      (!voiceoverScript &&
                                        !compassDescription &&
                                        !compassUrl)
                                    }
                                    onClick={handleGenerateVoiceover}
                                  >
                                    {voiceoverGenerating ? (
                                      <>
                                        <Loader2
                                          size={14}
                                          strokeWidth={1.6}
                                          className="g-spin"
                                        />{" "}
                                        Generating…
                                      </>
                                    ) : voiceoverScript &&
                                      lastUsedVoiceId &&
                                      selectedVoiceId !== lastUsedVoiceId ? (
                                      <>
                                        <Mic size={14} strokeWidth={1.6} /> Try
                                        this voice
                                      </>
                                    ) : (
                                      <>
                                        <Mic size={14} strokeWidth={1.6} /> Generate
                                        voiceover
                                      </>
                                    )}
                                  </button>

                                  {/* Stage indicator */}
                                  {voiceoverGenerating && voiceoverStage && (
                                    <div className="g-vo-stage">
                                      <Loader2
                                        size={14}
                                        strokeWidth={1.6}
                                        className="g-spin"
                                        style={{ color: "var(--accent)" }}
                                      />
                                      {voiceoverStage}
                                    </div>
                                  )}

                                  {/* Error */}
                                  {voiceoverError && (
                                    <p className="g-vo-error">{voiceoverError}</p>
                                  )}

                                  {/* Result */}
                                  {voiceoverPreviewUrl && voiceoverScript && (
                                    <div className="g-vo-result">
                                      <audio
                                        controls
                                        src={voiceoverPreviewUrl}
                                        className="g-vo-audio"
                                      />
                                      <blockquote className="g-vo-script">
                                        {voiceoverScript}
                                      </blockquote>
                                      <button
                                        type="button"
                                        className="g-vo-regen"
                                        onClick={() => {
                                          setVoiceoverPreviewUrl(null);
                                          setVoiceoverScript(null);
                                          setLastUsedVoiceId(null);
                                        }}
                                      >
                                        <RotateCcw size={12} strokeWidth={1.6} />
                                        Regenerate
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* Voice clone */}
                        <div
                          className={`g-addon-row${addVoiceClone ? " active" : ""}`}
                        >
                          <button
                            type="button"
                            className="g-addon-head"
                            onClick={() => {
                              if (!addVoiceClone) setAddVoiceover(false);
                              setAddVoiceClone(!addVoiceClone);
                            }}
                          >
                            <span
                              className={`g-addon-icon${addVoiceClone ? " on" : ""}`}
                            >
                              <User size={14} strokeWidth={1.6} />
                            </span>
                            <div className="g-addon-meta">
                              <div className="g-addon-title-row">
                                <span className="g-addon-title">Voice clone</span>
                                <span className="g-addon-price g-tabular">
                                  {hasExistingClone
                                    ? `+ $${VOICE_CLONE_PER_VIDEO}`
                                    : `+ $${VOICE_CLONE_SETUP + VOICE_CLONE_PER_VIDEO}`}
                                </span>
                              </div>
                              <p className="g-addon-desc">
                                Narrate every video in your own voice. We'll
                                schedule a 15-minute recording session within one
                                business day.
                              </p>
                              <p className="g-addon-note">
                                {hasExistingClone
                                  ? `Voice clone on file — $${VOICE_CLONE_SETUP} setup waived`
                                  : `$${VOICE_CLONE_SETUP} one-time setup + $${VOICE_CLONE_PER_VIDEO}/video`}
                              </p>
                            </div>
                            <span
                              className={`g-addon-switch${addVoiceClone ? " on" : ""}`}
                            >
                              <span className="g-addon-switch-knob" />
                            </span>
                          </button>
                        </div>

                        {/* Custom request */}
                        <div
                          className={`g-addon-row${addCustomRequest ? " active" : ""}`}
                        >
                          <button
                            type="button"
                            className="g-addon-head"
                            onClick={() => setAddCustomRequest(!addCustomRequest)}
                          >
                            <span
                              className={`g-addon-icon${addCustomRequest ? " on" : ""}`}
                            >
                              <Sparkles size={14} strokeWidth={1.6} />
                            </span>
                            <div className="g-addon-meta">
                              <div className="g-addon-title-row">
                                <span className="g-addon-title">
                                  Custom request
                                </span>
                                <span className="g-addon-price g-tabular">
                                  + $15
                                </span>
                              </div>
                              <p className="g-addon-desc">
                                Specific shots, music cues, or pacing notes routed
                                to the production team.
                              </p>
                            </div>
                            <span
                              className={`g-addon-switch${addCustomRequest ? " on" : ""}`}
                            >
                              <span className="g-addon-switch-knob" />
                            </span>
                          </button>

                          <AnimatePresence>
                            {addCustomRequest && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.4, ease: EASE }}
                                style={{ overflow: "hidden" }}
                              >
                                <div className="g-addon-body">
                                  <textarea
                                    value={customRequestText}
                                    onChange={(e) =>
                                      setCustomRequestText(e.target.value)
                                    }
                                    placeholder="e.g. lead with the kitchen island, golden hour exteriors at the end, prefer mellow piano over pop."
                                    className="g-custom-text"
                                    rows={4}
                                  />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </SectionCard>
                  </motion.div>
                )}

                {/* ─── Step 3 — Photos ─── */}
                {step === 3 && (
                  <motion.div
                    key="step-3"
                    variants={stepFade}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                  >
                    <SectionCard
                      label="Photos"
                      title="Upload 10–60 property photos"
                      sub="JPG, PNG, HEIC, WebP. Mix exteriors, interiors, and detail shots. More variety = more cinematic compositions."
                      right={
                        <div className="g-photo-counter">
                          <span className="g-photo-counter-val">{files.length}</span>
                          <span className="g-photo-counter-divider">/</span>
                          <span className="g-photo-counter-max">60</span>
                        </div>
                      }
                    >
                      {/* Drop zone */}
                      <div
                        className={`g-dropzone${isDragging ? " dragging" : ""}`}
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
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept=".jpg,.jpeg,.png,.heic,.webp"
                          style={{ display: "none" }}
                          onChange={(e) =>
                            e.target.files && handleFiles(e.target.files)
                          }
                        />
                        <input
                          ref={folderInputRef}
                          type="file"
                          {...({
                            webkitdirectory: "",
                            directory: "",
                          } as React.HTMLAttributes<HTMLInputElement>)}
                          style={{ display: "none" }}
                          onChange={(e) =>
                            e.target.files && handleFiles(e.target.files)
                          }
                        />
                        <div className="g-dropzone-icon">
                          <Image size={20} strokeWidth={1.6} />
                        </div>
                        <div className="g-dropzone-text">
                          <div className="g-dropzone-title">Drop photos to upload</div>
                          <div className="g-dropzone-sub">
                            or click to browse files
                          </div>
                        </div>
                        <div className="g-dropzone-foot">
                          <span>JPG · PNG · HEIC · WebP</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              folderInputRef.current?.click();
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--ink-2)",
                              fontSize: 11,
                              fontWeight: 500,
                              fontFamily: "inherit",
                              textDecoration: "underline",
                            }}
                          >
                            Import folder
                          </button>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="g-photo-progress">
                        <div className="g-photo-progress-bar">
                          <div
                            className="g-photo-progress-fill"
                            style={{
                              width: `${Math.min(100, (files.length / 10) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="g-photo-progress-meta">
                          <span>
                            {files.length >= 10 ? (
                              <span className="g-photo-progress-good">
                                <Check size={12} strokeWidth={2.4} />
                                Minimum reached
                              </span>
                            ) : (
                              `${10 - files.length} more to reach minimum`
                            )}
                          </span>
                          <span className="g-tabular">{formatSize(totalSize)}</span>
                        </div>
                      </div>

                      {/* Thumbnails */}
                      {files.length > 0 && (
                        <div className="g-photo-grid">
                          <AnimatePresence>
                            {files.map((f) => (
                              <motion.div
                                key={f.id}
                                initial={{ opacity: 0, scale: 0.85 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.85 }}
                                transition={{ duration: 0.35, ease: EASE }}
                                className="g-photo-tile"
                              >
                                <div className="g-photo-thumb">
                                  <img src={f.preview} alt="" />
                                </div>
                                <button
                                  type="button"
                                  className="g-photo-remove"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeFile(f.id);
                                  }}
                                  aria-label="Remove photo"
                                >
                                  <X size={11} strokeWidth={2.2} />
                                </button>
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        </div>
                      )}
                    </SectionCard>

                    {/* Submit error */}
                    {submitError && (
                      <div className="g-submit-error">{submitError}</div>
                    )}

                    {/* Sign-in prompt */}
                    {!authLoading && !user && (
                      <div className="g-signin-prompt">
                        <p className="g-signin-text">
                          Sign in to finalise your order — your voice clone, presets,
                          and order history are saved to your account.
                        </p>
                        <button
                          type="button"
                          className="g-cta-primary"
                          onClick={openLogin}
                        >
                          Sign in
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Step nav */}
              <div className="g-step-nav">
                <button
                  type="button"
                  className="g-btn-ghost"
                  disabled={step === 0 || submitting}
                  onClick={back}
                  style={{ opacity: step === 0 ? 0.4 : 1 }}
                >
                  <ArrowLeft size={13} /> Back
                </button>

                <div className="g-step-nav-status">
                  <span
                    className="g-step-nav-dot"
                    style={{
                      background: canAdvance
                        ? "var(--good)"
                        : "var(--muted-2)",
                    }}
                  />
                  {canAdvance ? "Ready" : "Missing required fields"}
                </div>

                {step < 3 ? (
                  <button
                    type="button"
                    className="g-cta-primary"
                    disabled={!canAdvance}
                    onClick={next}
                    style={{ opacity: canAdvance ? 1 : 0.5 }}
                  >
                    Continue <ArrowRight size={13} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="g-cta-primary"
                    disabled={!canSubmit || submitting}
                    onClick={handleSubmit}
                    style={{ opacity: canSubmit && !submitting ? 1 : 0.5 }}
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={14} strokeWidth={1.6} className="g-spin" />
                        {uploadProgress
                          ? `${uploadProgress.uploaded} / ${uploadProgress.total}`
                          : "Submitting…"}
                      </>
                    ) : (
                      <>
                        Submit listing <ArrowRight size={13} />
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Right: order summary */}
            <aside className="g-order-rail">
              <div className="g-order-card">
                <div className="g-order-head">
                  <span className="g-label" style={{ fontSize: 11.5 }}>
                    Order summary
                  </span>
                  <h3 className="g-order-title">
                    {selectedPkgName || "—"}
                  </h3>
                  <div className="g-order-sub">
                    {selectedDuration ?? "—"}{" "}
                    {selectedOriLabel ? `· ${selectedOriLabel}` : ""}
                    {isLifeCycle ? " · 3 videos" : ""}
                  </div>
                </div>

                {/* Property thumb */}
                <div className="g-order-thumb">
                  <div
                    className="g-order-thumb-art"
                    style={{
                      background: `linear-gradient(135deg, hsl(${(address.length * 13) % 360}, 14%, 72%), hsl(${((address.length * 13) + 40) % 360}, 16%, 46%))`,
                    }}
                  >
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="rgba(255,255,255,0.9)"
                      strokeWidth="1.4"
                    >
                      <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z" />
                    </svg>
                  </div>
                  <div className="g-order-thumb-meta">
                    <div className="g-order-address">{address || "—"}</div>
                    <div className="g-order-specs">
                      {bedrooms || "—"} bd · {bathrooms || "—"} ba ·{" "}
                      {sqft ? `${formatNumber(Number(sqft))} sqft` : "— sqft"}
                    </div>
                  </div>
                </div>

                {/* Line items */}
                <div className="g-order-lines">
                  {basePrice > 0 && (
                    <div className="g-order-line">
                      <div className="g-order-line-label">
                        {selectedPkgName || "Package"}{" "}
                        {selectedDuration ? `· ${selectedDuration}` : ""}
                      </div>
                      <div className="g-order-line-val">${basePrice}</div>
                    </div>
                  )}
                  {orientationExtra > 0 && (
                    <div className="g-order-line">
                      <div className="g-order-line-label">
                        {selectedOriLabel} format
                      </div>
                      <div className="g-order-line-val">+${orientationExtra}</div>
                    </div>
                  )}
                  {addVoiceover && (
                    <div className="g-order-line">
                      <div className="g-order-line-label">AI voiceover</div>
                      <div className="g-order-line-val">+${voiceoverExtra}</div>
                    </div>
                  )}
                  {addVoiceClone && (
                    <div className="g-order-line">
                      <div className="g-order-line-label">
                        <div>Voice clone</div>
                        {!hasExistingClone && (
                          <div className="g-order-line-sub">setup + first render</div>
                        )}
                      </div>
                      <div className="g-order-line-val">+${voiceCloneExtra}</div>
                    </div>
                  )}
                  {addCustomRequest && (
                    <div className="g-order-line">
                      <div className="g-order-line-label">Custom request</div>
                      <div className="g-order-line-val">+${customExtra}</div>
                    </div>
                  )}
                </div>

                {/* Total */}
                <div className="g-order-total">
                  <span>Total</span>
                  <span className="g-order-total-val g-tabular">${totalPrice.toLocaleString()}</span>
                </div>

                {/* Meta rows */}
                <div className="g-order-meta">
                  <div className="g-order-meta-row">
                    <span className="g-order-meta-icon">
                      <Image size={13} />
                    </span>
                    <span className="g-order-meta-label">Photos</span>
                    <span className="g-order-meta-val">{files.length} attached</span>
                  </div>
                  <div className="g-order-meta-row">
                    <span className="g-order-meta-icon">
                      <Clock size={13} />
                    </span>
                    <span className="g-order-meta-label">Delivery</span>
                    <span className="g-order-meta-val">~ 72 hours</span>
                  </div>
                  <div className="g-order-meta-row">
                    <span className="g-order-meta-icon">
                      <Box size={13} />
                    </span>
                    <span className="g-order-meta-label">Pipeline</span>
                    <span className="g-order-meta-val">Auto-route</span>
                  </div>
                </div>
              </div>

              {/* Operator note */}
              <div className="g-order-help">
                <div className="g-order-help-title">Note</div>
                <p className="g-order-help-body">
                  Submission charges the agent's card on file. The pipeline kicks
                  off the moment Stripe confirms — no manual action needed.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {/* Save preset dialog */}
      <Dialog open={showSavePreset} onOpenChange={setShowSavePreset}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em" }}>
              {presetSaved ? "Saved." : "Save as preset"}
            </DialogTitle>
          </DialogHeader>
          {presetSaved ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
                padding: "24px 0",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "rgba(47, 138, 85, 0.1)",
                  border: "1px solid rgba(47, 138, 85, 0.3)",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--good)",
                }}
              >
                <CheckCircle2 size={22} strokeWidth={1.5} />
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
    </ShellFrame>
  );
};

export default Upload;
