import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  createProperty,
  getSupabase,
  insertPhotos,
} from '../../lib/db.js';
import {
  createCheckoutSession,
  formatLineItemsForOrder,
  sumLineItemsCents,
} from '../../lib/billing/stripe.js';
import { isOwnerBypassEligible } from '../../lib/billing/owner-bypass.js';
import { requireAuth } from '../../lib/auth.js';
import { runPipeline } from '../../lib/pipeline.js';
import type { Property } from '../../lib/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  try {
    const page = parseInt((req.query.page as string) ?? '1', 10);
    const limit = parseInt((req.query.limit as string) ?? '25', 10);
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * limit;

    let query = getSupabase()
      .from('properties')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (search) query = query.ilike('address', `%${search}%`);

    const { data, count, error } = await query;
    if (error) throw error;

    return res.status(200).json({
      properties: data,
      total: count,
      page,
      totalPages: Math.ceil((count ?? 0) / limit),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list properties' });
  }
}

/**
 * Resolve the base URL for Stripe success/cancel redirect URLs.
 * Priority: x-forwarded-host header > origin header > VERCEL_URL env > localhost fallback.
 */
function resolveOrigin(req: VercelRequest): string {
  const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;
  if (forwardedHost) {
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https';
    return `${proto}://${forwardedHost}`;
  }
  const origin = req.headers.origin as string | undefined;
  if (origin) return origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:5173';
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
  // Auth gate — customer must be signed in to finalize an order.
  const auth = await requireAuth(req, res);
  if (!auth) return; // requireAuth already wrote the 401.

  try {
    const {
      address, price, bedrooms, bathrooms, listing_agent, brokerage,
      tempId, photoPaths, driveLink,
      selectedPackage, selectedDuration, selectedOrientation,
      addVoiceover, addVoiceClone, addCustomRequest, customRequestText,
      daysOnMarket, soldPrice,
      voiceoverPreviewUrl,
      pipeline_mode,
    } = req.body;

    console.log('POST /api/properties body:', JSON.stringify({
      address, price, bedrooms, bathrooms, listing_agent,
      tempId, driveLink,
      photoPathsCount: Array.isArray(photoPaths) ? photoPaths.length : 'not array',
      photoPathsSample: Array.isArray(photoPaths) ? photoPaths.slice(0, 2) : photoPaths,
      selectedPackage, selectedDuration, selectedOrientation,
      addVoiceover, addVoiceClone, addCustomRequest,
      hasCustomRequestText: !!customRequestText,
      daysOnMarket, soldPrice,
    }));

    if (!address || !price || !bedrooms || !bathrooms || !listing_agent) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Normalize duration: form sends "15s" | "30s" | "60s" or already-int.
    const durationInt = typeof selectedDuration === 'string'
      ? parseInt(selectedDuration.replace(/s$/, ''), 10)
      : typeof selectedDuration === 'number'
        ? selectedDuration
        : null;
    const validDuration = durationInt === 15 || durationInt === 30 || durationInt === 60
      ? durationInt
      : null;

    // Create property record
    const property = await createProperty({
      address,
      price: parseInt(price, 10),
      bedrooms: parseInt(bedrooms, 10),
      bathrooms: parseFloat(bathrooms),
      listing_agent,
      brokerage: brokerage || undefined,
      selected_package: selectedPackage ?? null,
      selected_duration: validDuration,
      selected_orientation: selectedOrientation ?? null,
      add_voiceover: !!addVoiceover,
      add_voice_clone: !!addVoiceClone,
      add_custom_request: !!addCustomRequest,
      custom_request_text: customRequestText ?? null,
      days_on_market: typeof daysOnMarket === 'number'
        ? daysOnMarket
        : (daysOnMarket ? parseInt(daysOnMarket, 10) : null),
      sold_price: typeof soldPrice === 'number'
        ? soldPrice
        : (soldPrice ? parseInt(soldPrice, 10) : null),
      // New: start in pending_payment; webhook flips to queued on success.
      status: 'pending_payment',
      stripe_payment_status: 'unpaid',
      // Bind property to the authenticated user.
      submitted_by: auth.user.id,
      // v1.1 Seedance push-in toggle — only set when explicitly opted-in.
      ...(pipeline_mode === 'v1.1' ? { pipeline_mode: 'v1.1' as const } : {}),
    });

    const supabase = getSupabase();
    let photoCount = 0;

    if (driveLink) {
      // Google Drive mode — store the link, pipeline will download photos async
      await supabase
        .from('properties')
        .update({ drive_link: driveLink })
        .eq('id', property.id);

      // Pipeline will handle downloading photos from Drive
      // For now, respond instantly — photos are fetched in the background
      photoCount = -1; // indicates "pending from Drive"
    } else if (photoPaths && Array.isArray(photoPaths)) {
      // Direct upload mode — photos already in Supabase Storage
      const photoRecords: Array<{ property_id: string; file_url: string; file_name: string }> = [];

      for (const storagePath of photoPaths) {
        const fileName = storagePath.split('/').pop() || 'unknown.jpg';
        const { data: urlData } = supabase.storage
          .from('property-photos')
          .getPublicUrl(storagePath);

        photoRecords.push({
          property_id: property.id,
          file_url: urlData.publicUrl,
          file_name: fileName,
        });
      }

      if (photoRecords.length > 0) {
        await insertPhotos(photoRecords);
        await supabase
          .from('properties')
          .update({ photo_count: photoRecords.length })
          .eq('id', property.id);
        photoCount = photoRecords.length;
      }
    }

    // If a voiceover preview URL was generated pre-submit, persist it to the property.
    // The preview MP3 is already in Supabase storage (voiceovers/preview/...);
    // we just save the URL — the pipeline reads voiceover_url at render time.
    if (voiceoverPreviewUrl && typeof voiceoverPreviewUrl === 'string') {
      await supabase
        .from('properties')
        .update({ voiceover_url: voiceoverPreviewUrl })
        .eq('id', property.id);
    }

    // Look up the user's voice clone state to decide whether the $125 setup
    // fee applies and whether to bump their status to 'requested'.
    const { data: profileForClone } = await supabase
      .from('user_profiles')
      .select('voice_clone_status, elevenlabs_voice_id')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    const hasExistingVoiceClone =
      profileForClone?.voice_clone_status === 'ready' ||
      !!profileForClone?.elevenlabs_voice_id;

    // Voice clone is staff-driven — when a customer toggles it on, we don't
    // run IVC inline. Bump their user_profiles.voice_clone_status to
    // 'requested' so the team queue surfaces them.
    // Skip the bump if they already have a clone (status='ready') — no reset.
    if (addVoiceClone && !hasExistingVoiceClone) {
      const currentStatus = profileForClone?.voice_clone_status ?? 'none';
      if (currentStatus === 'none' || currentStatus === 'failed') {
        await supabase
          .from('user_profiles')
          .update({
            voice_clone_status: 'requested',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', auth.user.id);
      }
    }

    // Compute line items and total amount.
    const lineItems = formatLineItemsForOrder(
      property as unknown as Property,
      { hasExistingVoiceClone },
    );
    const amountCents = sumLineItemsCents(lineItems);

    // Owner test-bypass: skip Stripe entirely for allowlisted admin emails.
    // Mirrors the side effects of the checkout.session.completed webhook so
    // the pipeline fires the same way it would after a real payment.
    const bypass = isOwnerBypassEligible({
      email: auth.user.email,
      role: auth.profile.role,
    });

    if (bypass) {
      const nowIso = new Date().toISOString();
      await supabase
        .from('properties')
        .update({
          status: 'queued',
          stripe_session_id: null,
          stripe_amount_cents: 0,
          stripe_payment_status: 'paid',
          stripe_paid_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', property.id);

      // If this order included voice-clone setup, comp it on user_profiles
      // (mirrors the webhook's idempotent update with cost=0).
      if (addVoiceClone && !hasExistingVoiceClone) {
        const { data: existingProfile } = await supabase
          .from('user_profiles')
          .select('voice_clone_paid_at')
          .eq('user_id', auth.user.id)
          .maybeSingle();
        if (!existingProfile?.voice_clone_paid_at) {
          await supabase
            .from('user_profiles')
            .update({
              voice_clone_paid_cents: 0,
              voice_clone_paid_at: nowIso,
              updated_at: nowIso,
            })
            .eq('user_id', auth.user.id);
        }
      }

      console.log(
        `[api/properties] Owner bypass for ${auth.user.email} — property ${property.id} comped (would have been ${amountCents}¢). Firing pipeline...`,
      );
      // Fire pipeline like the webhook does — async, errors captured inside.
      runPipeline(property.id).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[api/properties] runPipeline error for ${property.id}:`, msg);
      });

      return res.status(201).json({
        property: { ...property, stripe_amount_cents: 0, stripe_payment_status: 'paid' },
        bypassed: true,
        photoCount,
        _debug: {
          receivedPhotoPaths: Array.isArray(photoPaths) ? photoPaths.length : typeof photoPaths,
          receivedDriveLink: !!driveLink,
          tempId: tempId || null,
        },
      });
    }

    // Create Stripe Checkout Session.
    const origin = resolveOrigin(req);
    const { sessionId, url: checkoutUrl } = await createCheckoutSession({
      propertyId: property.id,
      userId: auth.user.id,
      lineItems,
      successUrl: `${origin}/upload/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/upload/cancelled?session_id={CHECKOUT_SESSION_ID}&property_id=${property.id}`,
      metadata: { tempId: tempId || '' },
    });

    // Persist session ID and computed amount on the property row.
    await supabase
      .from('properties')
      .update({
        stripe_session_id: sessionId,
        stripe_amount_cents: amountCents,
        stripe_payment_status: 'pending',
      })
      .eq('id', property.id);

    // Return property + checkout URL. Client redirects to Stripe Checkout.
    // Pipeline is NOT triggered here — the webhook handler does that.
    return res.status(201).json({
      property: { ...property, stripe_session_id: sessionId, stripe_amount_cents: amountCents },
      checkoutUrl,
      photoCount,
      _debug: {
        receivedPhotoPaths: Array.isArray(photoPaths) ? photoPaths.length : typeof photoPaths,
        receivedDriveLink: !!driveLink,
        tempId: tempId || null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error creating property:', msg, err);
    return res.status(500).json({ error: 'Failed to create property', detail: msg });
  }
}
