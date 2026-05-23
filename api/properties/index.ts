import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  createProperty,
  getSupabase,
  insertPhotos,
} from '../../lib/db.js';

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

async function handlePost(req: VercelRequest, res: VercelResponse) {
  try {
    const {
      address, price, bedrooms, bathrooms, listing_agent, brokerage,
      tempId, photoPaths, driveLink,
      selectedPackage, selectedDuration, selectedOrientation,
      addVoiceover, addVoiceClone, addCustomRequest, customRequestText,
      daysOnMarket, soldPrice, pipeline_mode,
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

    // Pipeline is triggered separately via POST /api/pipeline/[propertyId]
    return res.status(201).json({
      id: property.id,
      status: 'queued',
      photoCount,
      _debug: {
        receivedPhotoPaths: Array.isArray(photoPaths) ? photoPaths.length : typeof photoPaths,
        receivedDriveLink: !!driveLink,
        tempId: tempId || null,
      },
      message: 'Video generation started',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error creating property:', msg, err);
    return res.status(500).json({ error: 'Failed to create property', detail: msg });
  }
}
