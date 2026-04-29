export interface SampleReel {
  id: string;
  title: string;
  durationSec: number;
  posterUrl: string;
  videoUrl: string;
}

const MOCK_REELS: SampleReel[] = [
  {
    id: "coastal-modern",
    title: "Coastal Modern · Sample",
    durationSec: 38,
    posterUrl: "https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1600&q=80",
    videoUrl: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  },
  {
    id: "urban-loft",
    title: "Urban Loft · Sample",
    durationSec: 42,
    posterUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1600&q=80",
    videoUrl: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  },
  {
    id: "estate",
    title: "Estate · Sample",
    durationSec: 51,
    posterUrl: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1600&q=80",
    videoUrl: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
  },
];

export async function getSampleReels(): Promise<SampleReel[]> {
  return MOCK_REELS;
}
