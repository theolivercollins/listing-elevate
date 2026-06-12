import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getMarketUpdateConfig,
  analyzeMarketUpdate,
  generateMarketUpdate,
  getMarketUpdateRun,
  listMarketUpdateRuns,
  createTemplate,
  createEmailTemplate,
  fileToBase64,
  getPost,
  getEmail,
  publishPost,
  sendEmail,
  type MuConfig,
  type MuRegionResult,
  type MuRunListItem,
} from "@/lib/blog/api-client";
import { validateTemplateTokens } from "../../../lib/blog-engine/market-update/validate-template";
import { PageHeading, Card } from "@/components/dashboard/primitives";
import { Icon, type IconName } from "@/components/dashboard/icons";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (m: number) => MONTHS[m - 1] ?? String(m);

const METRIC_ROWS: { key: string; label: string }[] = [
  { key: "for_sale", label: "For Sale" },
  { key: "sold", label: "Sold" },
  { key: "pended", label: "Pending" },
  { key: "median_sold_price", label: "Median Sold Price" },
  { key: "avg_sold_price", label: "Avg Sold Price" },
  { key: "avg_for_sale_price", label: "Avg For-Sale Price" },
  { key: "avg_ppsf", label: "Avg $/SqFt" },
  { key: "dom", label: "Days on Market" },
  { key: "sold_to_list", label: "Sold / List Ratio" },
  { key: "moi_closed", label: "MOI (Closed)" },
  { key: "moi_pended", label: "MOI (Pended)" },
  { key: "absorption_closed", label: "Absorption (Closed)" },
  { key: "absorption_pended", label: "Absorption (Pended)" },
];

// Route /dashboard/studio/blog/market-update[/:id] — index (new run + history) or run detail.
export default function MarketUpdate() {
  const { id } = useParams();
  return id ? <RunDetail runId={id} /> : <RunIndex />;
}

// ─── Index: start a new run + browse previous runs ────────────────
function RunIndex() {
  const navigate = useNavigate();
  const now = new Date();
  const { data: config, isLoading } = useQuery<MuConfig>({ queryKey: ["mu-config"], queryFn: getMarketUpdateConfig });
  const { data: runsData } = useQuery({ queryKey: ["mu-runs"], queryFn: listMarketUpdateRuns });
  const qc = useQueryClient();

  const [month, setMonth] = useState<number>(now.getMonth() === 0 ? 12 : now.getMonth());
  const [year, setYear] = useState<number>(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [blogTemplateId, setBlogTemplateId] = useState<string>("");
  const [emailTemplateId, setEmailTemplateId] = useState<string>("");
  const [files, setFiles] = useState<Record<string, File>>({});

  useMemo(() => {
    if (config && !blogTemplateId && config.blog_templates[0]) setBlogTemplateId(config.blog_templates[0].id);
    if (config && !emailTemplateId && config.email_templates[0]) setEmailTemplateId(config.email_templates[0].id);
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadTemplate = useMutation({
    mutationFn: async ({ role, file }: { role: "blog" | "email"; file: File }) => {
      const html = await file.text();
      // Validate token coverage before committing to the DB.
      const validation = validateTemplateTokens(html, role);
      if (validation.errors.length > 0) {
        throw new Error(validation.errors.join("\n"));
      }
      const name = file.name.replace(/\.html?$/i, "") || `Market Update ${role}`;
      const metadata = { kind: "market_update", mu_role: role };
      const { id } = role === "blog"
        ? await createTemplate({ name, body_html: html, default_category_label: "Market Update", metadata })
        : await createEmailTemplate({ name, body_html: html, metadata });
      return { role, id, name, warnings: validation.warnings };
    },
    onSuccess: async ({ role, id, name, warnings }) => {
      await qc.invalidateQueries({ queryKey: ["mu-config"] });
      if (role === "blog") setBlogTemplateId(id); else setEmailTemplateId(id);
      toast.success(`Uploaded "${name}" and selected it.`);
      // Surface missing-token warnings as non-blocking toasts so Oliver can
      // decide whether the template has the coverage he needs.
      if (warnings.length > 0) {
        const missing = warnings.map((w) => w.replace(/ — canonical token not used in this template$/, "")).join(", ");
        toast.warning(`Template is missing ${warnings.length} canonical token${warnings.length === 1 ? "" : "s"}: ${missing}`);
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Template upload failed"),
  });

  const regions = config?.regions ?? [];
  const allUploaded = regions.length > 0 && regions.every((r) => files[r.slug]);

  const analyze = useMutation({
    mutationFn: async () => {
      const regionPayload = await Promise.all(
        regions.map(async (r) => ({ slug: r.slug, filename: files[r.slug].name, pdf_base64: await fileToBase64(files[r.slug]) })),
      );
      return analyzeMarketUpdate({ period_month: month, period_year: year, blog_template_id: blogTemplateId, email_template_id: emailTemplateId || null, regions: regionPayload });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["mu-runs"] });
      toast.success("Extraction done — opening the run.");
      navigate(`/dashboard/studio/blog/market-update/${r.run_id}`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Extraction failed"),
  });

  const runs = runsData?.runs ?? [];

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeading eyebrow="Content · Blog · Market Update" title="Monthly Market Update" sub="Upload the three regional stat reports, validate the math, and generate publish-ready drafts. Every run is saved below." />

      {isLoading ? <Spinner /> : (
        <Card padding={24}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <SectionLabel n={1} text="Period & templates" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
              <Field label="Data month">
                <select className="le-input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <Field label="Year">
                <input className="le-input" type="number" value={year} min={2000} max={2100} onChange={(e) => setYear(Number(e.target.value))} />
              </Field>
              <Field label="Blog template">
                <select className="le-input" value={blogTemplateId} onChange={(e) => setBlogTemplateId(e.target.value)}>
                  {(config?.blog_templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <UploadTemplateLink role="blog" pending={uploadTemplate.isPending} onPick={(file) => uploadTemplate.mutate({ role: "blog", file })} />
              </Field>
              <Field label="Email template (Charlotte County)">
                <select className="le-input" value={emailTemplateId} onChange={(e) => setEmailTemplateId(e.target.value)}>
                  <option value="">None</option>
                  {(config?.email_templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <UploadTemplateLink role="email" pending={uploadTemplate.isPending} onPick={(file) => uploadTemplate.mutate({ role: "email", file })} />
              </Field>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: -6 }}>
              The selected templates are pre-loaded defaults. Upload your own <strong>Blog_Template_MU.html</strong> / <strong>Email_Template_MU.html</strong> above (keep the <code>{`{{TOKEN}}`}</code> names), or edit them under{" "}
              <Link to="/dashboard/studio/blog/templates" style={{ color: "var(--accent)" }}>Blog templates</Link> ·{" "}
              <Link to="/dashboard/studio/email/templates" style={{ color: "var(--accent)" }}>Email templates</Link>.
            </p>

            <SectionLabel n={2} text="Upload the regional reports (PDF)" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {regions.map((r) => (
                <UploadSlot key={r.slug} label={r.display_name}
                  note={[r.emits_email ? "blog + email" : "blog", r.strip_images ? "text only" : "with images"].join(" · ")}
                  file={files[r.slug] ?? null} onPick={(f) => setFiles((prev) => ({ ...prev, [r.slug]: f }))} />
              ))}
            </div>

            <div>
              <button className="le-btn-dark" disabled={!allUploaded || !blogTemplateId || analyze.isPending} onClick={() => analyze.mutate()}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, opacity: !allUploaded || !blogTemplateId ? 0.5 : 1 }}>
                {analyze.isPending ? <SpinnerInline /> : <Icon name="play" size={13} />}
                {analyze.isPending ? "Extracting & validating… (~30–60s)" : "Run extraction"}
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* ── Previous runs ─────────────────────────────────────── */}
      <Card padding={24}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionLabel n={3} text="Previous runs" />
          {runs.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>No runs yet — your first one will appear here.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {runs.map((run) => <RunRow key={run.id} run={run} />)}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function RunRow({ run }: { run: MuRunListItem }) {
  const drafts = (run.created_post_ids?.length ?? 0) + (run.created_email_ids?.length ?? 0);
  return (
    <Link to={`/dashboard/studio/blog/market-update/${run.id}`} style={{ textDecoration: "none" }}>
      <div className="le-lift" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
        <Icon name="trend-up" size={15} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", minWidth: 140 }}>{monthName(run.period_month)} {run.period_year}</span>
        <StatusBadge status={run.status} />
        <span style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>{drafts > 0 ? `${drafts} draft${drafts === 1 ? "" : "s"}` : "no drafts yet"}</span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(run.created_at).toLocaleDateString()}</span>
        <Icon name="chevron-right" size={14} />
      </div>
    </Link>
  );
}

// ─── Detail: one saved run ────────────────────────────────────────
function RunDetail({ runId }: { runId: string }) {
  const qc = useQueryClient();
  const [ackWarnings, setAckWarnings] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ["mu-run", runId], queryFn: () => getMarketUpdateRun(runId) });
  const run = data?.run;

  const generate = useMutation({
    mutationFn: () => generateMarketUpdate(runId, ackWarnings),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["mu-run", runId] });
      qc.invalidateQueries({ queryKey: ["mu-runs"] });
      toast.success(`Created ${r.post_ids.length} blog draft${r.post_ids.length === 1 ? "" : "s"}${r.email_ids.length ? " + 1 email draft" : ""}.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Generation failed"),
  });

  const results: MuRegionResult[] = run?.region_results ?? [];
  const hasErrors = results.some((r) => !r.metrics || r.issues.some((i) => i.severity === "error"));
  const hasWarnings = results.some((r) => r.issues.some((i) => i.severity === "warning"));
  const generated = run?.status === "generated";

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeading
        eyebrow={<Link to="/dashboard/studio/blog/market-update" style={{ color: "var(--muted)", textDecoration: "none" }}>← Market Update</Link>}
        title={run ? `${monthName(run.period_month)} ${run.period_year}` : "Market Update run"}
        sub="Extracted metrics, validation, and the drafts this run produced."
        actions={run ? <StatusBadge status={run.status} /> : undefined}
      />

      {isLoading ? <Spinner /> : error || !run ? (
        <Card padding={32}><div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Run not found. <Link to="/dashboard/studio/blog/market-update" style={{ color: "var(--accent)" }}>Back to Market Update</Link>.</div></Card>
      ) : (
        <>
          <Card padding={24}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <SectionLabel n={1} text="Extracted metrics & validation" />
              {results.map((r) => <RegionCard key={r.region_slug} r={r} />)}
            </div>
          </Card>

          {!generated && (
            <Card padding={24}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <SectionLabel n={2} text="Generate drafts" />
                {hasErrors ? (
                  <p style={{ fontSize: 13, color: "var(--bad)" }}>
                    A region has a blocking issue (red flags above) — either a number that didn't reconcile against the source, or a report too sparse to read. Re-upload a corrected report and run extraction again. (Metrics simply missing from a summary report are amber warnings, not blockers.)
                  </p>
                ) : (
                  <>
                    {hasWarnings && (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                        <input type="checkbox" checked={ackWarnings} onChange={(e) => setAckWarnings(e.target.checked)} />
                        I've reviewed the amber warnings and want to proceed.
                      </label>
                    )}
                    <p style={{ fontSize: 13, color: "var(--muted)" }}>This creates draft blog posts (and the Charlotte County email) — nothing publishes until you approve each one.</p>
                    <div>
                      <button className="le-btn-dark" disabled={generate.isPending || (hasWarnings && !ackWarnings)} onClick={() => generate.mutate()}
                        style={{ display: "inline-flex", alignItems: "center", gap: 7, opacity: hasWarnings && !ackWarnings ? 0.5 : 1 }}>
                        {generate.isPending ? <SpinnerInline /> : <Icon name="spark" size={13} />}
                        {generate.isPending ? "Generating drafts…" : "Generate drafts"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}

          {generated && (
            <Card padding={24}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SectionLabel n={2} text="Drafts — review & publish" />
                <p style={{ fontSize: 13, color: "var(--muted)" }}>
                  Each draft shows its live status. Use the action button to publish to Sierra or send via Sendy — each requires an explicit confirmation step.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {results.filter((r) => r.post_id).map((r) => (
                    <PostDraftPanel key={r.post_id} postId={r.post_id!} label={`${r.region_name} — blog post`} runId={runId} />
                  ))}
                  {results.filter((r) => r.email_id).map((r) => (
                    <EmailDraftPanel key={r.email_id} emailId={r.email_id!} label={`${r.region_name} — email`} runId={runId} />
                  ))}
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── Post draft panel with live status + Publish action ──────────

// States that mean the post has already been published (no action needed).
const PUBLISHED_POST_STATES = new Set(["live", "editing", "edit_pending", "quarantined"]);

// Human-readable label for a blog post state.
function postStateLabel(state: string): string {
  const MAP: Record<string, string> = {
    awaiting_approval: "Draft",
    publish_due: "Publish queued",
    publishing: "Publishing…",
    live: "Published",
    on_hold: "On hold",
    edit_pending: "Edit pending",
    editing: "Editing",
    quarantined: "Quarantined",
  };
  return MAP[state] ?? state;
}
function PostDraftPanel({ postId, label, runId }: { postId: string; label: string; runId: string }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const { data } = useQuery({
    queryKey: ["blog-post", postId],
    queryFn: () => getPost(postId),
    staleTime: 30_000,
  });
  const post = data?.post;
  const state = post?.state ?? "";
  const isPublished = PUBLISHED_POST_STATES.has(state);

  const publishMut = useMutation({
    mutationFn: () => publishPost(postId),
    onSuccess: () => {
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ["blog-post", postId] });
      qc.invalidateQueries({ queryKey: ["mu-run", runId] });
      toast.success("Publish queued — Sierra will go live shortly.");
    },
    onError: (e: any) => {
      setConfirming(false);
      toast.error(e?.message ?? "Publish failed");
    },
  });

  // Defer rendering the testid wrapper until data loads so tests can use
  // waitFor(getByTestId) and synchronously assert badge state.
  if (!data) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)", opacity: 0.5 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{label}</span>
      </div>
    );
  }

  return (
    <div
      data-testid={`draft-panel-post-${postId}`}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)" }}
    >
      <Icon name="book" size={15} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {post?.title ?? label}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{label}</div>
      </div>
      <DraftStateBadge state={state} kind="post" />
      <Link
        to={`/dashboard/studio/blog/posts/${postId}`}
        style={{ display: "inline-flex", alignItems: "center", color: "var(--muted)", padding: "4px 6px" }}
        title="Open post detail"
        aria-label="Open post detail"
      >
        <Icon name="external" size={13} />
      </Link>
      {!isPublished && !confirming && (
        <button
          data-testid={`publish-btn-${postId}`}
          onClick={() => setConfirming(true)}
          disabled={publishMut.isPending || !post}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", border: "1px solid var(--ink)", borderRadius: "var(--radius)", background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--ink)", fontFamily: "var(--le-font-sans)", whiteSpace: "nowrap" }}
        >
          <Icon name="play" size={11} strokeWidth={2} />
          Publish to Sierra
        </button>
      )}
      {!isPublished && confirming && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--bad)", fontWeight: 500 }}>Publish this post?</span>
          <button
            data-testid={`publish-confirm-${postId}`}
            onClick={() => publishMut.mutate()}
            disabled={publishMut.isPending}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", border: "none", borderRadius: "var(--radius)", background: "var(--ink)", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--surface)", fontFamily: "var(--le-font-sans)" }}
          >
            {publishMut.isPending ? <SpinnerInline /> : "Yes, publish"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={publishMut.isPending}
            style={{ padding: "5px 8px", border: "none", borderRadius: "var(--radius)", background: "transparent", cursor: "pointer", fontSize: 12, color: "var(--muted)", fontFamily: "var(--le-font-sans)" }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Email draft panel with live status + Send action ─────────────

const SENT_EMAIL_STATES = new Set(["sending", "sent"]);

function emailStateLabel(state: string): string {
  const MAP: Record<string, string> = {
    draft: "Draft",
    ready: "Ready",
    sending: "Sending…",
    sent: "Sent",
    failed: "Failed",
  };
  return MAP[state] ?? state;
}

/**
 * EmailDraftPanel — shows live state of the MU email draft and provides a two-step
 * send action.
 *
 * Send resolution: api/blog/emails/[id]/send.ts resolves list IDs from:
 *   1. POST body { list_ids }   — override (what we pass here)
 *   2. row.recipients_json      — row-level default
 *
 * MU email rows are inserted without recipients_json (defaults to []).
 * So we always pass list_ids from local state in the confirm step.
 * Oliver enters the Sendy list ID(s) once per send action; previous values are
 * not persisted (each run creates a new email row). This keeps the panel
 * self-contained without a DB migration for a default list column.
 */
function EmailDraftPanel({ emailId, label, runId }: { emailId: string; label: string; runId: string }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  // Oliver types Sendy list IDs (comma-separated) before confirming the send.
  const [listInput, setListInput] = useState("");

  const { data } = useQuery({
    queryKey: ["blog-email", emailId],
    queryFn: () => getEmail(emailId),
    staleTime: 30_000,
  });
  const email = data?.email;
  const state = email?.state ?? "";
  const isSent = SENT_EMAIL_STATES.has(state);

  const sendMut = useMutation({
    mutationFn: () => {
      // Parse list IDs from the input field (comma-separated, trim whitespace).
      const listIds = listInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return sendEmail(emailId, listIds.length > 0 ? { list_ids: listIds } : undefined);
    },
    onSuccess: () => {
      setConfirming(false);
      setListInput("");
      qc.invalidateQueries({ queryKey: ["blog-email", emailId] });
      qc.invalidateQueries({ queryKey: ["mu-run", runId] });
      toast.success("Email sent via Sendy.");
    },
    onError: (e: any) => {
      setConfirming(false);
      toast.error(e?.message ?? "Send failed");
    },
  });

  // Defer rendering the testid wrapper until data loads.
  if (!data) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)", opacity: 0.5 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{label}</span>
      </div>
    );
  }

  return (
    <div
      data-testid={`draft-panel-email-${emailId}`}
      style={{ display: "flex", flexDirection: confirming ? "column" : "row", alignItems: confirming ? "flex-start" : "center", gap: 10, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)" }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
        <Icon name="delivered" size={15} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {email?.subject ?? label}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{label}</div>
        </div>
        <DraftStateBadge state={state} kind="email" />
        <Link
          to={`/dashboard/studio/email/messages/${emailId}`}
          style={{ display: "inline-flex", alignItems: "center", color: "var(--muted)", padding: "4px 6px" }}
          title="Open email detail"
          aria-label="Open email detail"
        >
          <Icon name="external" size={13} />
        </Link>
        {!isSent && !confirming && (
          <button
            data-testid={`send-btn-${emailId}`}
            onClick={() => setConfirming(true)}
            disabled={sendMut.isPending || !email}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", border: "1px solid var(--ink)", borderRadius: "var(--radius)", background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--ink)", fontFamily: "var(--le-font-sans)", whiteSpace: "nowrap" }}
          >
            <Icon name="delivered" size={11} strokeWidth={2} />
            Send via Sendy
          </button>
        )}
      </div>

      {/* Confirm row — list ID entry + send button */}
      {!isSent && confirming && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", paddingTop: 4 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            Sendy list ID(s) to send to{" "}
            <span style={{ color: "var(--bad)", fontWeight: 600 }}>*</span>
            <span style={{ fontSize: 11, marginLeft: 6 }}>(comma-separate multiple)</span>
          </label>
          <input
            data-testid={`send-list-input-${emailId}`}
            className="le-input"
            style={{ fontSize: 12, maxWidth: 380 }}
            placeholder="e.g. abc123 or abc123, def456"
            value={listInput}
            onChange={(e) => setListInput(e.target.value)}
            disabled={sendMut.isPending}
          />
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button
              data-testid={`send-confirm-${emailId}`}
              onClick={() => sendMut.mutate()}
              disabled={sendMut.isPending || !listInput.trim()}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", border: "none", borderRadius: "var(--radius)", background: "var(--ink)", cursor: sendMut.isPending || !listInput.trim() ? "default" : "pointer", fontSize: 12, fontWeight: 600, color: "var(--surface)", fontFamily: "var(--le-font-sans)", opacity: !listInput.trim() ? 0.5 : 1 }}
            >
              {sendMut.isPending ? <SpinnerInline /> : "Yes, send"}
            </button>
            <button
              onClick={() => { setConfirming(false); setListInput(""); }}
              disabled={sendMut.isPending}
              style={{ padding: "5px 8px", border: "none", borderRadius: "var(--radius)", background: "transparent", cursor: "pointer", fontSize: 12, color: "var(--muted)", fontFamily: "var(--le-font-sans)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DraftStateBadge — status badge for live post/email state ─────
function DraftStateBadge({ state, kind }: { state: string; kind: "post" | "email" }) {
  type ToneColor = { bg: string; fg: string; label: string };

  const postMap: Record<string, ToneColor> = {
    // draft_ready is the state MU inserts — treat like a Draft before publish.
    draft_ready:       { bg: "color-mix(in srgb, var(--muted) 12%, transparent)", fg: "var(--muted)", label: "Draft" },
    awaiting_approval: { bg: "color-mix(in srgb, var(--muted) 12%, transparent)", fg: "var(--muted)", label: "Draft" },
    publish_due:       { bg: "color-mix(in srgb, var(--accent) 12%, transparent)", fg: "var(--accent)", label: "Publish queued" },
    publishing:        { bg: "color-mix(in srgb, var(--accent) 12%, transparent)", fg: "var(--accent)", label: "Publishing…" },
    live:              { bg: "color-mix(in srgb, var(--good) 14%, transparent)", fg: "var(--good)", label: "Published" },
    on_hold:           { bg: "color-mix(in srgb, var(--muted) 12%, transparent)", fg: "var(--muted)", label: "On hold" },
    edit_pending:      { bg: "color-mix(in srgb, var(--accent) 12%, transparent)", fg: "var(--accent)", label: "Edit pending" },
    editing:           { bg: "color-mix(in srgb, var(--accent) 12%, transparent)", fg: "var(--accent)", label: "Editing" },
    quarantined:       { bg: "color-mix(in srgb, var(--bad) 14%, transparent)", fg: "var(--bad)", label: "Quarantined" },
  };

  const emailMap: Record<string, ToneColor> = {
    draft:   { bg: "color-mix(in srgb, var(--muted) 12%, transparent)", fg: "var(--muted)", label: "Draft" },
    ready:   { bg: "color-mix(in srgb, var(--accent) 12%, transparent)", fg: "var(--accent)", label: "Ready" },
    sending: { bg: "color-mix(in srgb, var(--accent) 12%, transparent)", fg: "var(--accent)", label: "Sending…" },
    sent:    { bg: "color-mix(in srgb, var(--good) 14%, transparent)", fg: "var(--good)", label: "Sent" },
    failed:  { bg: "color-mix(in srgb, var(--bad) 14%, transparent)", fg: "var(--bad)", label: "Failed" },
  };

  const fallback: ToneColor = { bg: "color-mix(in srgb, var(--muted) 10%, transparent)", fg: "var(--muted)", label: state || "…" };
  const s = (kind === "post" ? postMap[state] : emailMap[state]) ?? fallback;

  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: "var(--radius-pill)", background: s.bg, color: s.fg, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

// ─── shared sub-components ────────────────────────────────────────
function SectionLabel({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--ink)", color: "var(--surface)", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{text}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      {children}
    </div>
  );
}

function UploadTemplateLink({ role, pending, onPick }: { role: "blog" | "email"; pending: boolean; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} disabled={pending}
        style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4, padding: 0, border: "none", background: "transparent", cursor: pending ? "default" : "pointer", color: "var(--accent)", fontSize: 11.5, fontFamily: "var(--le-font-sans)" }}>
        <Icon name="upload" size={11} />
        {pending ? "Uploading…" : `Upload ${role} .html`}
      </button>
      <input ref={ref} type="file" accept=".html,text/html" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
    </>
  );
}

function UploadSlot({ label, note, file, onPick }: { label: string; note: string; file: File | null; onPick: (f: File) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, padding: "14px 16px", border: `1px dashed ${file ? "var(--accent)" : "var(--line)"}`, borderRadius: "var(--radius)", cursor: "pointer", background: file ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Icon name={file ? "check" : "upload"} size={14} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{label}</span>
      </div>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{note}</span>
      <span style={{ fontSize: 11, color: file ? "var(--ink)" : "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file ? file.name : "Choose PDF…"}</span>
      <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }} />
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    extracting: { bg: "var(--line-2)", fg: "var(--muted)", label: "Extracting" },
    ready: { bg: "color-mix(in srgb, var(--good) 14%, transparent)", fg: "var(--good)", label: "Ready" },
    needs_review: { bg: "color-mix(in srgb, var(--bad) 14%, transparent)", fg: "var(--bad)", label: "Needs review" },
    generated: { bg: "color-mix(in srgb, var(--accent) 14%, transparent)", fg: "var(--accent)", label: "Generated" },
    failed: { bg: "color-mix(in srgb, var(--bad) 14%, transparent)", fg: "var(--bad)", label: "Failed" },
  };
  const s = map[status] ?? { bg: "var(--line-2)", fg: "var(--muted)", label: status };
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: "var(--radius-pill)", background: s.bg, color: s.fg }}>{s.label}</span>;
}

function RegionCard({ r }: { r: MuRegionResult }) {
  const errors = r.issues.filter((i) => i.severity === "error");
  const warnings = r.issues.filter((i) => i.severity === "warning");
  const m = r.metrics?.metrics ?? null;
  return (
    <div style={{ border: "1px solid var(--line-2)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--surface-2, var(--line-2))" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{r.region_name}</span>
        <span style={{ display: "flex", gap: 6 }}>
          {errors.length > 0 && <Pill tone="bad">{errors.length} error{errors.length === 1 ? "" : "s"}</Pill>}
          {warnings.length > 0 && <Pill tone="warn">{warnings.length} warning{warnings.length === 1 ? "" : "s"}</Pill>}
          {errors.length === 0 && warnings.length === 0 && <Pill tone="good">validated</Pill>}
        </span>
      </div>
      {m && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: "6px 14px" }}>Metric</th>
                <th style={{ padding: "6px 14px" }}>Value</th>
                <th style={{ padding: "6px 14px" }}>MoM</th>
                <th style={{ padding: "6px 14px" }}>YoY</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map((row) => {
                const s = m[row.key];
                if (!s) return null;
                const bad = errors.some((e) => e.field.startsWith(row.key + "."));
                const missing = s.current === null || s.current === undefined;
                return (
                  <tr key={row.key} style={{ borderTop: "1px solid var(--line-2)", background: bad ? "color-mix(in srgb, var(--bad) 7%, transparent)" : "transparent", opacity: missing ? 0.5 : 1 }}>
                    <td style={{ textAlign: "left", padding: "6px 14px", color: "var(--ink)" }}>{row.label}</td>
                    <td style={{ textAlign: "right", padding: "6px 14px", color: "var(--ink)", fontWeight: 600 }}>{missing ? "—" : String(s.current)}</td>
                    <td style={{ textAlign: "right", padding: "6px 14px" }}><Delta v={s.mom_pct} /></td>
                    <td style={{ textAlign: "right", padding: "6px 14px" }}><Delta v={s.yoy_pct} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {r.issues.length > 0 && (
        <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 5, borderTop: "1px solid var(--line-2)" }}>
          {r.issues.map((i, idx) => (
            <div key={idx} style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 12 }}>
              <Icon name="alert" size={13} />
              <span style={{ color: i.severity === "error" ? "var(--bad)" : "var(--muted)" }}>{i.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Delta({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span style={{ color: "var(--muted)" }}>—</span>;
  const up = v > 0.05, down = v < -0.05;
  const color = up ? "var(--good)" : down ? "var(--bad)" : "var(--muted)";
  return <span style={{ color }}>{up ? "+" : ""}{v}%</span>;
}

function Pill({ tone, children }: { tone: "good" | "bad" | "warn"; children: React.ReactNode }) {
  const c = tone === "good" ? "var(--good)" : tone === "bad" ? "var(--bad)" : "#b45309";
  return <span style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>{children}</span>;
}

// DraftLink is kept for potential external use (type-safe icon param).
// The RunDetail panel no longer uses it — see PostDraftPanel / EmailDraftPanel above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DraftLink({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return (
    <Link to={to} style={{ textDecoration: "none" }}>
      <div className="le-lift" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
        <Icon name={icon} size={15} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", flex: 1 }}>{label}</span>
        <Icon name="external" size={13} />
      </div>
    </Link>
  );
}

function Spinner() {
  return (
    <div style={{ padding: "64px 0", display: "flex", justifyContent: "center" }}>
      <SpinnerInline />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
function SpinnerInline() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </svg>
  );
}

// Suppress unused variable warning for helper functions kept for reference.
void postStateLabel;
void emailStateLabel;
