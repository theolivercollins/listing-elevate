/**
 * lib/billing/stripe.ts — Stripe client singleton + Checkout Session helpers.
 *
 * All server-side Stripe interactions go through this module.
 * Never import this file from the browser bundle — it reads STRIPE_SECRET_KEY.
 */

import Stripe from "stripe";
import type { Property } from "../types.js";
import {
  getBasePrice,
  getOrientationExtra,
  VOICEOVER_PER_VIDEO,
  VOICE_CLONE_PER_VIDEO,
  CUSTOM_REQUEST_PRICE,
  VOICE_CLONE_SETUP,
} from "./pricing.js";

// ── Singleton ────────────────────────────────────────────────────────────────

let _stripeClient: Stripe | null = null;

/**
 * Returns the lazily-initialised Stripe client.
 * Throws at call time (not import time) if STRIPE_SECRET_KEY is missing,
 * so tests that mock the module don't fail on import.
 */
export function getStripeClient(): Stripe {
  if (_stripeClient) return _stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to your Vercel environment variables.",
    );
  }
  _stripeClient = new Stripe(key, {
    // Pin the API version we code against.
    apiVersion: "2025-06-30.basil",
  });
  return _stripeClient;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface LineItem {
  name: string;
  amountCents: number;
  quantity?: number;
}

export interface CheckoutSessionOpts {
  propertyId: string;
  userId: string;
  lineItems: LineItem[];
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

// ── createCheckoutSession ────────────────────────────────────────────────────

/**
 * Creates a Stripe Checkout Session in 'payment' mode (one-time charge).
 *
 * - `client_reference_id` is set to `propertyId` so the webhook can look up
 *   the property without storing anything extra.
 * - `metadata` is merged with `{ propertyId, userId }` for redundant lookup.
 */
export async function createCheckoutSession(
  opts: CheckoutSessionOpts,
): Promise<CheckoutSessionResult> {
  const stripe = getStripeClient();

  const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
    opts.lineItems.map((item) => ({
      price_data: {
        currency: "usd",
        unit_amount: item.amountCents,
        product_data: { name: item.name },
      },
      quantity: item.quantity ?? 1,
    }));

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: opts.propertyId,
    customer_email: opts.customerEmail,
    line_items: stripeLineItems,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: {
      propertyId: opts.propertyId,
      userId: opts.userId,
      ...opts.metadata,
    },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }

  return { sessionId: session.id, url: session.url };
}

// ── createVoiceCloneCheckoutSession ─────────────────────────────────────────

export interface VoiceCloneCheckoutOpts {
  userId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

/**
 * Creates a Checkout Session for the $125 voice-clone setup fee.
 * This session has NO propertyId — it is fired by admin staff, not by the
 * order form. The webhook uses `metadata.purpose === 'voice_clone_setup'` to
 * distinguish this from per-order sessions.
 *
 * @deprecated The $125 setup fee is now bundled into the initial order Checkout
 * Session via `formatLineItemsForOrder` (when `hasExistingVoiceClone` is false).
 * This function is retained for admin re-invoice flows only.
 */
export async function createVoiceCloneCheckoutSession(
  opts: VoiceCloneCheckoutOpts,
): Promise<CheckoutSessionResult> {
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: opts.customerEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: VOICE_CLONE_SETUP * 100,
          product_data: {
            name: "Voice Clone Setup",
            description:
              "One-time professional voice clone setup fee. Your custom voice is used on every future video.",
          },
        },
        quantity: 1,
      },
    ],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: {
      purpose: "voice_clone_setup",
      userId: opts.userId,
    },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL for voice clone session");
  }

  return { sessionId: session.id, url: session.url };
}

// ── verifyWebhookSignature ───────────────────────────────────────────────────

/**
 * Verifies the Stripe webhook signature and returns the parsed event.
 * Throws on invalid signature — callers should catch and return 400.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string,
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set. Cannot verify Stripe webhooks.",
    );
  }
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

// ── formatLineItemsForOrder ──────────────────────────────────────────────────

export interface FormatLineItemsOpts {
  /**
   * When true the $125 Voice Clone Setup line is omitted because the user
   * already has a clone on file.  Defaults to false (setup fee IS included).
   */
  hasExistingVoiceClone?: boolean;
}

/**
 * Derives Stripe line items from the persisted order-form fields on a property.
 *
 * Rules:
 * - Base package price is a single line item (e.g. "30-Second Just Listed").
 * - Orientation extra is a separate line if `selected_orientation === 'both'`.
 * - If `add_voice_clone === true` AND `opts.hasExistingVoiceClone !== true`, a
 *   one-time $125 Voice Clone Setup line is added BEFORE the per-video line.
 * - Voiceover / voice-clone per-video charge ($10) is added when either toggle
 *   is set.
 * - Custom request ($15) is a separate line if `add_custom_request === true`.
 *
 * All amounts are in cents.
 */
export function formatLineItemsForOrder(
  property: Property,
  opts?: FormatLineItemsOpts,
): LineItem[] {
  const items: LineItem[] = [];

  // Derive a human-readable duration label (e.g. "30-Second").
  const durLabel = property.selected_duration
    ? `${property.selected_duration}-Second`
    : "Video";

  // Derive a human-readable package label.
  const pkgLabels: Record<string, string> = {
    just_listed: "Just Listed",
    just_pended: "Just Pended",
    just_closed: "Just Closed",
    life_cycle: "Life Cycle Series",
  };
  const pkgLabel = property.selected_package
    ? (pkgLabels[property.selected_package] ?? property.selected_package)
    : "Video";

  // Duration string used by pricing lookup (e.g. "30s").
  const durStr = property.selected_duration
    ? `${property.selected_duration}s`
    : null;

  // Base price.
  const baseDollars = getBasePrice(durStr, property.selected_package);
  if (baseDollars > 0) {
    items.push({
      name: `${durLabel} ${pkgLabel}`,
      amountCents: baseDollars * 100,
    });
  }

  // Orientation extra.
  const orientationExtraDollars = getOrientationExtra(
    property.selected_orientation,
    property.selected_package,
  );
  if (orientationExtraDollars > 0) {
    items.push({
      name: "Both Orientations (9:16 + 16:9)",
      amountCents: orientationExtraDollars * 100,
    });
  }

  // Voice clone setup fee ($125 one-time) — only when the user does NOT already
  // have a clone on file.  The per-video charge always applies when cloning.
  if (property.add_voice_clone && opts?.hasExistingVoiceClone !== true) {
    items.push({
      name: "Voice Clone Setup (one-time)",
      amountCents: VOICE_CLONE_SETUP * 100,
    });
  }

  // Voiceover — covers both standard TTS and clone-voice synthesis.
  if (property.add_voiceover || property.add_voice_clone) {
    const voLabel = property.add_voice_clone
      ? "AI Voiceover (Cloned Voice)"
      : "AI Voiceover";
    const voCents = property.add_voice_clone
      ? VOICE_CLONE_PER_VIDEO * 100
      : VOICEOVER_PER_VIDEO * 100;
    items.push({ name: voLabel, amountCents: voCents });
  }

  // Custom request.
  if (property.add_custom_request) {
    items.push({
      name: "Custom Request",
      amountCents: CUSTOM_REQUEST_PRICE * 100,
    });
  }

  return items;
}

// ── sumLineItemsCents ────────────────────────────────────────────────────────

/** Convenience: sum all line items into a single total in cents. */
export function sumLineItemsCents(items: LineItem[]): number {
  return items.reduce((acc, item) => acc + item.amountCents * (item.quantity ?? 1), 0);
}

// ── Re-export pricing constants so consumers only need one import ─────────────

export { VOICE_CLONE_SETUP } from "./pricing.js";
