export interface Faq {
  id: string;
  question: string;
  answer: string;
}

const FAQS: Faq[] = [
  {
    id: "turnaround",
    question: "How fast will I get my video?",
    answer: "Under 24 hours from the moment you finish uploading. Every time.",
  },
  {
    id: "revisions",
    question: "What if I don't like the first cut?",
    answer: "Unlimited minor edits — reorder, trim, swap music, tweak copy. If the whole direction feels off, we re-run the pipeline free of charge.",
  },
  {
    id: "photos",
    question: "What photos do I need?",
    answer: "20 to 60 photos, any orientation. Phone-camera quality is fine. We handle exposure, crop, and order.",
  },
  {
    id: "pricing",
    question: "How much does it cost?",
    answer: "$65 for a single listing, $55 per listing on the five-pack. Brokerage volume pricing available.",
  },
  {
    id: "orientation",
    question: "Portrait or landscape?",
    answer: "Both. You get a 16:9 cut for MLS and a 9:16 cut for Instagram and TikTok on every order.",
  },
  {
    id: "voiceover",
    question: "Can I add voiceover?",
    answer: "Yes — generated voiceover is $15, or your own voice cloned (via a 30-second sample) is $25. Included free on the five-pack.",
  },
];

export function getFaqs(): Faq[] {
  return FAQS;
}
