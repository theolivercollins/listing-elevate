import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getMarketUpdateConfig,
  analyzeMarketUpdate,
  generateMarketUpdate,
  createTemplate,
  createEmailTemplate,
  fileToBase64,
  type MuConfig,
  type MuRegionResult,
  type MuAnalyzeResult,
} from "@/lib/blog/api-client";
import { PageHeading, Card } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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

export default function MarketUpdate() {
  const now = new Date();
  const { data: config, isLoading } = useQuery<MuConfig>({
    queryKey: ["mu-config"],
    queryFn: getMarketUpdateConfig,
  });

  const [month, setMonth] = useState<number>(now.getMonth() === 0 ? 12 : now.getMonth()); // default to last month
  const [year, setYear] = useState<number>(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [blogTemplateId, setBlogTemplateId] = useState<string>("");
  const [emailTemplateId, setEmailTemplateId] = useState<string>("");
  const [files, setFiles] = useState<Record<string, File>>({});
  const [run, setRun] = useState<MuAnalyzeResult | null>(null);
  const [ackWarnings, setAckWarnings] = useState(false);
  const [created, setCreated] = useState<{ posts: string[]; emails: string[] } | null>(null);

  const qc = useQueryClient();

  // Default the template selectors once config loads.
  useMemo(() => {
    if (config && !blogTemplateId && config.blog_templates[0]) setBlogTemplateId(config.blog_templates[0].id);
    if (config && !emailTemplateId && config.email_templates[0]) setEmailTemplateId(config.email_templates[0].id);
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  // Upload a real .html template file -> create it (tagged MU) -> select it.
  const uploadTemplate = useMutation({
    mutationFn: async ({ role, file }: { role: "blog" | "email"; file: File }) => {
      const html = await file.text();
      const name = file.name.replace(/\.html?$/i, "") || `Market Update ${role}`;
      const metadata = { kind: "market_update", mu_role: role };
      const { id } =
        role === "blog"
          ? await createTemplate({ name, body_html: html, default_category_label: "Market Update", metadata })
          : await createEmailTemplate({ name, body_html: html, metadata });
      return { role, id, name };
    },
    onSuccess: async ({ role, id, name }) => {
      await qc.invalidateQueries({ queryKey: ["mu-config"] });
      if (role === "blog") setBlogTemplateId(id);
      else setEmailTemplateId(id);
      toast.success(`Uploaded "${name}" and selected it.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Template upload failed"),
  });

  const regions = config?.regions ?? [];
  const allUploaded = regions.length > 0 && regions.every((r) => files[r.slug]);

  const analyze = useMutation({
    mutationFn: async () => {
      const regionPayload = await Promise.all(
        regions.map(async (r) => ({
          slug: r.slug,
          filename: files[r.slug].name,
          pdf_base64: await fileToBase64(files[r.slug]),
        })),
      );
      return analyzeMarketUpdate({
        period_month: month,
        period_year: year,
        blog_template_id: blogTemplateId,
        email_template_id: emailTemplateId || null,
        regions: regionPayload,
      });
    },
    onSuccess: (r) => {
      setRun(r);
      setCreated(null);
      setAckWarnings(false);
      if (r.status === "needs_review") toast.warning("Extraction done — review the flagged numbers before generating.");
      else toast.success("Extraction validated — ready to generate drafts.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Extraction failed"),
  });

  const generate = useMutation({
    mutationFn: () => generateMarketUpdate(run!.run_id, ackWarnings),
    onSuccess: (r) => {
      setCreated({ posts: r.post_ids, emails: r.email_ids });
      toast.success(`Created ${r.post_ids.length} blog draft${r.post_ids.length === 1 ? "" : "s"}${r.email_ids.length ? " + 1 email draft" : ""}.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Generation failed"),
  });

  const results = run?.region_results ?? [];
  const hasErrors = results.some((r) => !r.metrics || r.issues.some((i) => i.severity === "error"));
  const hasWarnings = results.some((r) => r.issues.some((i) => i.severity === "warning"));

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeading
        eyebrow="Content · Blog · Market Update"
        title="Monthly Market Update"
        sub="Upload the three regional stat reports, validate the math, and generate publish-ready drafts."
      />

      {isLoading ? (
        <Spinner />
      ) : (
        <>
          {/* ── Setup ─────────────────────────────────────────── */}
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
                  <UploadTemplateLink
                    role="blog"
                    pending={uploadTemplate.isPending}
                    onPick={(file) => uploadTemplate.mutate({ role: "blog", file })}
                  />
                </Field>
                <Field label="Email template (Charlotte County)">
                  <select className="le-input" value={emailTemplateId} onChange={(e) => setEmailTemplateId(e.target.value)}>
                    <option value="">None</option>
                    {(config?.email_templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <UploadTemplateLink
                    role="email"
                    pending={uploadTemplate.isPending}
                    onPick={(file) => uploadTemplate.mutate({ role: "email", file })}
                  />
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
                  <UploadSlot
                    key={r.slug}
                    label={r.display_name}
                    note={[r.emits_email ? "blog + email" : "blog", r.strip_images ? "text only" : "with images"].join(" · ")}
                    file={files[r.slug] ?? null}
                    onPick={(f) => setFiles((prev) => ({ ...prev, [r.slug]: f }))}
                  />
                ))}
              </div>

              <div>
                <button
                  className="le-btn-dark"
                  disabled={!allUploaded || !blogTemplateId || analyze.isPending}
                  onClick={() => analyze.mutate()}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, opacity: !allUploaded || !blogTemplateId ? 0.5 : 1 }}
                >
                  {analyze.isPending ? <SpinnerInline /> : <Icon name="play" size={13} />}
                  {analyze.isPending ? "Extracting & validating…" : "Run extraction"}
                </button>
              </div>
            </div>
          </Card>

          {/* ── Results ───────────────────────────────────────── */}
          {run && (
            <Card padding={24}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <SectionLabel n={3} text="Extracted metrics & validation" />
                  <StatusBadge status={run.status} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {results.map((r) => <RegionCard key={r.region_slug} r={r} />)}
                </div>
              </div>
            </Card>
          )}

          {/* ── Generate ──────────────────────────────────────── */}
          {run && !created && (
            <Card padding={24}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <SectionLabel n={4} text="Generate drafts" />
                {hasErrors ? (
                  <p style={{ fontSize: 13, color: "var(--bad)" }}>
                    A region has a blocking issue (red flags above) — either a number that didn't reconcile against the source, or a report too sparse to read. Check the flags, re-upload a corrected report if needed, and run extraction again. (Metrics simply missing from a summary report are amber warnings, not blockers — you can still generate.)
                  </p>
                ) : (
                  <>
                    {hasWarnings && (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                        <input type="checkbox" checked={ackWarnings} onChange={(e) => setAckWarnings(e.target.checked)} />
                        I've reviewed the amber warnings and want to proceed.
                      </label>
                    )}
                    <p style={{ fontSize: 13, color: "var(--muted)" }}>
                      This creates draft blog posts (and the Charlotte County email) — nothing publishes until you approve each one.
                    </p>
                    <div>
                      <button
                        className="le-btn-dark"
                        disabled={generate.isPending || (hasWarnings && !ackWarnings)}
                        onClick={() => generate.mutate()}
                        style={{ display: "inline-flex", alignItems: "center", gap: 7, opacity: hasWarnings && !ackWarnings ? 0.5 : 1 }}
                      >
                        {generate.isPending ? <SpinnerInline /> : <Icon name="spark" size={13} />}
                        {generate.isPending ? "Generating drafts…" : "Generate drafts"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}

          {/* ── Created drafts ────────────────────────────────── */}
          {created && (
            <Card padding={24}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SectionLabel n={5} text="Drafts created — review & publish" />
                <p style={{ fontSize: 13, color: "var(--muted)" }}>Open each draft to review, then publish to Sierra / send via Sendy from its detail page.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {created.posts.map((id) => (
                    <DraftLink key={id} to={`/dashboard/studio/blog/posts/${id}`} icon="book" label="Blog draft" />
                  ))}
                  {created.emails.map((id) => (
                    <DraftLink key={id} to={`/dashboard/studio/email/messages/${id}`} icon="delivered" label="Email draft" />
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

// ─── sub-components ───────────────────────────────────────────────
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
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={pending}
        style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4, padding: 0, border: "none", background: "transparent", cursor: pending ? "default" : "pointer", color: "var(--accent)", fontSize: 11.5, fontFamily: "var(--le-font-sans)" }}
      >
        <Icon name="upload" size={11} />
        {pending ? "Uploading…" : `Upload ${role} .html`}
      </button>
      <input
        ref={ref} type="file" accept=".html,text/html" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }}
      />
    </>
  );
}

function UploadSlot({ label, note, file, onPick }: { label: string; note: string; file: File | null; onPick: (f: File) => void }) {
  return (
    <label
      style={{
        display: "flex", flexDirection: "column", gap: 6, padding: "14px 16px",
        border: `1px dashed ${file ? "var(--accent)" : "var(--line)"}`, borderRadius: "var(--radius)",
        cursor: "pointer", background: file ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Icon name={file ? "check" : "upload"} size={14} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{label}</span>
      </div>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{note}</span>
      <span style={{ fontSize: 11, color: file ? "var(--ink)" : "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {file ? file.name : "Choose PDF…"}
      </span>
      <input
        type="file" accept="application/pdf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }}
      />
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    ready: { bg: "color-mix(in srgb, var(--good) 14%, transparent)", fg: "var(--good)", label: "Ready" },
    needs_review: { bg: "color-mix(in srgb, var(--bad) 14%, transparent)", fg: "var(--bad)", label: "Needs review" },
    generated: { bg: "color-mix(in srgb, var(--accent) 14%, transparent)", fg: "var(--accent)", label: "Generated" },
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
                return (
                  <tr key={row.key} style={{ borderTop: "1px solid var(--line-2)", background: bad ? "color-mix(in srgb, var(--bad) 7%, transparent)" : "transparent" }}>
                    <td style={{ textAlign: "left", padding: "6px 14px", color: "var(--ink)" }}>{row.label}</td>
                    <td style={{ textAlign: "right", padding: "6px 14px", color: "var(--ink)", fontWeight: 600 }}>{String(s.current ?? "—")}</td>
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

function DraftLink({ to, icon, label }: { to: string; icon: string; label: string }) {
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
