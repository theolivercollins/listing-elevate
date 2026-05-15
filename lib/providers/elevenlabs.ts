// ElevenLabs TTS + Instant Voice Cloning provider.
// Docs: https://elevenlabs.io/docs/api-reference
//
// Pricing verified 2026-05 — reconcile against invoices.
const MODEL_PRICING: Record<string, number> = {
  "eleven_turbo_v2_5": 0.000050,   // $50/1M chars — fast, cheap, multilingual
  "eleven_multilingual_v2": 0.000180, // $180/1M chars
  "eleven_v3": 0.000220,            // $220/1M chars
};

const BASE_URL = "https://api.elevenlabs.io/v1";

export class ElevenLabsProvider {
  static readonly DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // ElevenLabs "Sarah" — warm female

  private readonly apiKey: string;

  constructor() {
    // Read inside constructor so importing this module in dev without the key
    // doesn't crash on module evaluation.
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
    this.apiKey = key;
  }

  /**
   * Text-to-speech. Returns audio buffer + char count + cost cents.
   */
  async textToSpeech(opts: {
    voiceId: string;
    text: string;
    modelId?: string;
    stability?: number;
    similarityBoost?: number;
  }): Promise<{ audioBuffer: Buffer; chars: number; costCents: number; modelId: string }> {
    const modelId = opts.modelId ?? "eleven_turbo_v2_5";
    const url = `${BASE_URL}/text-to-speech/${encodeURIComponent(opts.voiceId)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: modelId,
        voice_settings: {
          stability: opts.stability ?? 0.5,
          similarity_boost: opts.similarityBoost ?? 0.75,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");
      throw new Error(`ElevenLabs TTS error ${response.status}: ${body}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    const chars = opts.text.length;
    const pricePerChar = MODEL_PRICING[modelId] ?? MODEL_PRICING["eleven_turbo_v2_5"];
    const costCents = Math.ceil(chars * pricePerChar * 100);

    return { audioBuffer, chars, costCents, modelId };
  }

  /**
   * Instant Voice Cloning. Takes one or more audio samples.
   * The clone API call itself is free on our end.
   */
  async cloneVoice(opts: {
    name: string;
    description?: string;
    samples: Array<{ filename: string; mimeType: string; data: Buffer }>;
  }): Promise<{ voiceId: string }> {
    const formData = new FormData();
    formData.append("name", opts.name);
    if (opts.description) {
      formData.append("description", opts.description);
    }
    for (const sample of opts.samples) {
      const blob = new Blob([sample.data], { type: sample.mimeType });
      formData.append("files", blob, sample.filename);
    }

    const response = await fetch(`${BASE_URL}/voices/add`, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");
      throw new Error(`ElevenLabs IVC error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as { voice_id: string };
    return { voiceId: json.voice_id };
  }
}
