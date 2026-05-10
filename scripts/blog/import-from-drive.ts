// scripts/blog/import-from-drive.ts
import "dotenv/config";
import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, basename, relative, dirname } from "node:path";
import { createHash } from "node:crypto";
import { getSupabase } from "../../lib/client.js";
import { uploadImageBuffer } from "../../lib/blog-engine/image-storage.js";

const FOLDER_URL = process.argv[2];
if (!FOLDER_URL) {
  console.error("usage: import-from-drive <google-drive-folder-url>");
  process.exit(2);
}

function checkGdownInstalled() {
  try {
    execSync("gdown --version", { stdio: "ignore" });
  } catch {
    console.error("gdown not installed. Install with: pip install gdown   (or pipx install gdown)");
    process.exit(2);
  }
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function* walkImages(
  dir: string,
  base: string,
): Generator<{ path: string; rel: string; folderHint: string | null }> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkImages(full, base);
    else if (IMAGE_EXTS.has(extname(entry.name).toLowerCase())) {
      const rel = relative(base, full);
      const parent = dirname(rel);
      yield { path: full, rel, folderHint: parent && parent !== "." ? parent : null };
    }
  }
}

async function main() {
  const supabase = getSupabase();
  const { data: site, error: sErr } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (sErr || !site) throw new Error("no Sierra blog_sites row — run seed-helgemo-site.ts first");

  let tmp: string;
  if (process.env.IMPORT_FROM_DIR) {
    // Reuse an existing local directory (e.g. partial gdown output, or a
    // manual zip extracted somewhere). Skips the Drive download.
    tmp = process.env.IMPORT_FROM_DIR;
    console.log(`using existing dir ${tmp}`);
  } else {
    checkGdownInstalled();
    tmp = mkdtempSync(join(tmpdir(), "blog-import-"));
    console.log(`downloading to ${tmp} ...`);
    try {
      execSync(`gdown --folder "${FOLDER_URL}" -O "${tmp}"`, { stdio: "inherit" });
    } catch (e: any) {
      // gdown commonly hits Drive's per-file rate limit on large folders.
      // Continue with whatever was downloaded — file_hash dedup makes re-runs idempotent.
      console.warn(`gdown exited non-zero (likely rate-limited). Proceeding with partial set in ${tmp}`);
    }
  }

  let imported = 0, skipped = 0, failed = 0;
  for (const { path, rel, folderHint } of walkImages(tmp, tmp)) {
    try {
      const buffer = readFileSync(path);
      const hash = createHash("sha256").update(buffer).digest("hex");

      const { data: existing } = await supabase
        .from("blog_images").select("id").eq("file_hash", hash).maybeSingle();
      if (existing) {
        skipped++;
        console.log(`  skip (already imported) ${rel}`);
        continue;
      }

      const ext = extname(path).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      const { blob_url, width, height, mime: outMime } = await uploadImageBuffer(supabase, {
        buffer, siteId: site.id, fileHash: hash, mime, filenameExt: ext,
      });

      const { data: imgRow, error: iErr } = await supabase
        .from("blog_images").insert([{
          site_id: site.id,
          blob_url, mime: outMime, width, height,
          file_hash: hash,
          metadata: { folder_hint: folderHint, original_filename: basename(path) },
        }]).select("id").single();
      if (iErr) throw iErr;

      const { error: jErr } = await supabase.from("blog_jobs").insert([{
        site_id: site.id, kind: "image_tag", payload: { image_id: imgRow!.id },
      }]);
      if (jErr) throw jErr;

      imported++;
      console.log(`  imported ${rel}`);
    } catch (e: any) {
      failed++;
      console.error(`  FAIL ${rel}: ${e?.message ?? e}`);
    }
  }

  console.log(`\ndone. imported=${imported} skipped=${skipped} failed=${failed}`);
  console.log(`tmp dir: ${tmp}  (failed images stay here for inspection)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
