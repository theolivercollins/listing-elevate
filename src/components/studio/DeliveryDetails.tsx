/**
 * DeliveryDetails — Details step UI for the operator delivery pipeline.
 *
 * - Prefills from delivery_run.listing_details (scraped values survive edits of
 *   other fields because the form always submits the FULL field set).
 * - Shows an amber scrape-miss banner when both price and beds are null/empty.
 * - "Save details" PATCHes /api/admin/studio/delivery/{runId} with ALL 5 fields
 *   (price, beds, baths, sqft, mls_description) coerced to numbers / null.
 *   The server stamps source:'manual' and logs a details_edit ml_event.
 * - The shared DeliveryNextButton (rendered in PropertyCommandCenter) advances
 *   details → voiceover.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authedFetch } from '@/lib/api';
import type { ListingDetails } from '../../../../lib/types/operator-studio';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeliveryDetailsProps {
  runId: string;
  listingDetails: ListingDetails;
  onSaved: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a string input to a positive number or null. Empty/whitespace → null. */
function parseNum(v: string): number | null {
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  return isFinite(n) && n >= 0 ? n : null;
}

/** True when the scrape produced nothing useful — both price and beds absent. */
function scrapeMissed(d: ListingDetails): boolean {
  return (d.price == null || d.price === undefined) && (d.beds == null || d.beds === undefined);
}

/** Format a numeric field as a string for controlled inputs. */
function numStr(v: number | null | undefined): string {
  return v != null ? String(v) : '';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeliveryDetails({ runId, listingDetails, onSaved }: DeliveryDetailsProps) {
  // Initialise from scraped/previously-saved values — all 5 fields always present.
  const [price, setPrice] = useState(numStr(listingDetails.price));
  const [beds, setBeds] = useState(numStr(listingDetails.beds));
  const [baths, setBaths] = useState(numStr(listingDetails.baths));
  const [sqft, setSqft] = useState(numStr(listingDetails.sqft));
  const [mlsDescription, setMlsDescription] = useState(listingDetails.mls_description ?? '');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const missed = scrapeMissed(listingDetails);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      // Always submit the full field set so a partial PATCH cannot silently null
      // scraped fields. The server REPLACES the whole listing_details jsonb column.
      const payload: Record<string, unknown> = {
        price: parseNum(price),
        beds: parseNum(beds),
        baths: parseNum(baths),
        sqft: parseNum(sqft),
        mls_description: mlsDescription.trim() === '' ? null : mlsDescription.trim(),
      };

      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      setSaved(true);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="studio-card" style={{ padding: 24 }}>
      {/* Eyebrow */}
      <span
        style={{
          display: 'block',
          fontSize: 11.5,
          fontWeight: 500,
          color: 'var(--le-muted)',
          marginBottom: 6,
        }}
      >
        Operator · Step
      </span>

      {/* Title */}
      <h3
        style={{
          margin: '0 0 16px 0',
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: 'var(--le-ink)',
        }}
      >
        Listing details
      </h3>

      {/* Scrape-miss banner */}
      {missed && (
        <div
          className="studio-warn-strip"
          style={{ marginBottom: 20 }}
          role="alert"
        >
          <span
            style={{ color: 'var(--le-warn, #b54708)', fontSize: 13, fontWeight: 500 }}
          >
            Scrape missed — enter listing details manually.
          </span>
        </div>
      )}

      {/* Numeric fields — 4-column grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px 16px',
          marginBottom: 16,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: 'var(--le-muted)',
            }}
          >
            Price ($)
          </span>
          <input
            type="number"
            min="0"
            step="1"
            className="studio-input studio-tabnum"
            value={price}
            onChange={(e) => { setPrice(e.target.value); setSaved(false); }}
            placeholder="e.g. 899000"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: 'var(--le-muted)',
            }}
          >
            Beds
          </span>
          <input
            type="number"
            min="0"
            step="1"
            className="studio-input studio-tabnum"
            value={beds}
            onChange={(e) => { setBeds(e.target.value); setSaved(false); }}
            placeholder="e.g. 3"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: 'var(--le-muted)',
            }}
          >
            Baths
          </span>
          <input
            type="number"
            min="0"
            step="0.5"
            className="studio-input studio-tabnum"
            value={baths}
            onChange={(e) => { setBaths(e.target.value); setSaved(false); }}
            placeholder="e.g. 2.5"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: 'var(--le-muted)',
            }}
          >
            Sq ft
          </span>
          <input
            type="number"
            min="0"
            step="1"
            className="studio-input studio-tabnum"
            value={sqft}
            onChange={(e) => { setSqft(e.target.value); setSaved(false); }}
            placeholder="e.g. 1823"
          />
        </label>
      </div>

      {/* MLS description */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 500,
            color: 'var(--le-muted)',
          }}
        >
          MLS description
        </span>
        <textarea
          className="studio-textarea"
          rows={5}
          value={mlsDescription}
          onChange={(e) => { setMlsDescription(e.target.value); setSaved(false); }}
          placeholder="Paste or type the MLS description…"
        />
      </label>

      {/* Save row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          className="studio-cta-primary"
          style={{ fontSize: 12.5, padding: '8px 16px' }}
          disabled={saving}
          onClick={handleSave}
        >
          {saving && <Loader2 size={12} className="studio-spinner" />}
          Save details
        </button>

        {saved && !saveError && (
          <span style={{ fontSize: 12, color: 'var(--le-good, #166534)', fontWeight: 500 }}>
            Saved
          </span>
        )}

        {saveError && (
          <span
            className="studio-error-strip"
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            {saveError}
          </span>
        )}
      </div>
    </div>
  );
}
