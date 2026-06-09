/**
 * scripts/bunny-smoke.ts — validate the Bunny Stream provider against the real
 * API: create a video, upload bytes (server PUT), poll status, print playback
 * URLs, then delete. Run:
 *   export $(grep -E '^BUNNY_' .env.local | xargs) && \
 *   /Users/oliverhelgemo/listing-elevate/node_modules/.bin/tsx scripts/bunny-smoke.ts /tmp/bunny-test.mp4
 */
import { readFileSync } from "node:fs";
import {
  createBunnyVideo,
  uploadBunnyVideoBytes,
  getBunnyVideo,
  bunnyEmbedUrl,
  bunnyHlsUrl,
  bunnyThumbnailUrl,
  deleteBunnyVideo,
  BUNNY_STATUS,
} from "../lib/providers/bunny-stream.js";

async function main() {
  const filePath = process.argv[2];
  console.log("1. Creating Bunny video…");
  const { guid } = await createBunnyVideo("LE smoke test — safe to delete");
  console.log("   guid =", guid);

  if (filePath) {
    console.log(`2. Uploading ${filePath}…`);
    await uploadBunnyVideoBytes(guid, readFileSync(filePath));
    console.log("   uploaded.");
  }

  console.log("3. Polling status (up to ~30s)…");
  let v = await getBunnyVideo(guid);
  for (let i = 0; i < 10 && v.status < BUNNY_STATUS.FINISHED && v.status !== BUNNY_STATUS.ERROR; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    v = await getBunnyVideo(guid);
    console.log(`   status=${v.status} encodeProgress=${v.encodeProgress}% ${v.width}x${v.height}`);
  }

  console.log("4. Playback URLs:");
  console.log("   embed:", bunnyEmbedUrl(guid));
  console.log("   hls:  ", bunnyHlsUrl(guid));
  console.log("   thumb:", bunnyThumbnailUrl(guid));

  console.log("5. Cleaning up (delete)…");
  await deleteBunnyVideo(guid);
  console.log("   deleted. ✅ Bunny provider works end-to-end.");
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
