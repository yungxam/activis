// Build the IMAGES gallery.
//
// Scans gallery/originals/ and produces, for every image:
//   gallery/thumbs/<id>.webp  (small grid thumbnail)
//   gallery/full/<id>.jpg     (downscaled full-size for the lightbox)
//   gallery/manifest.json     (the list the desktop reads)
//
// Originals are never served directly (they can be huge); only the optimized
// versions are. Run locally with `npm run build:gallery`, or let the GitHub
// Action do it automatically on push.

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'gallery', 'originals');
const THUMB_DIR = path.join(ROOT, 'gallery', 'thumbs');
const FULL_DIR = path.join(ROOT, 'gallery', 'full');
const MANIFEST = path.join(ROOT, 'gallery', 'manifest.json');

const THUMB_EDGE = 400;   // px, long edge of grid thumbnails
const FULL_EDGE = 1800;   // px, long edge of lightbox images
const THUMB_Q = 72;       // webp quality
const FULL_Q = 82;        // jpeg quality

const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.tif', '.tiff', '.heic', '.heif', '.bmp']);

function slugify(name) {
  return name.replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'img';
}

async function main() {
  await fs.mkdir(THUMB_DIR, { recursive: true });
  await fs.mkdir(FULL_DIR, { recursive: true });

  let entries = [];
  try {
    entries = (await fs.readdir(SRC))
      .filter((f) => !f.startsWith('.') && EXT.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  } catch {
    console.log('No gallery/originals/ directory yet — writing empty manifest.');
  }

  const manifest = [];
  const seen = new Set();
  const keepThumb = new Set();
  const keepFull = new Set();

  for (const file of entries) {
    let id = slugify(file), base = id, n = 2;
    while (seen.has(id)) id = base + '-' + (n++);
    seen.add(id);

    const src = path.join(SRC, file);
    const thumbName = id + '.webp';
    const fullName = id + '.jpg';
    try {
      await sharp(src, { failOn: 'none' }).rotate()
        .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: THUMB_Q })
        .toFile(path.join(THUMB_DIR, thumbName));

      const info = await sharp(src, { failOn: 'none' }).rotate()
        .resize({ width: FULL_EDGE, height: FULL_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: FULL_Q, mozjpeg: true })
        .toFile(path.join(FULL_DIR, fullName));

      manifest.push({
        id: id,
        thumb: 'thumbs/' + thumbName,
        full: 'full/' + fullName,
        w: info.width,
        h: info.height,
        alt: id.replace(/[-_]+/g, ' ').trim()
      });
      keepThumb.add(thumbName);
      keepFull.add(fullName);
      console.log('ok   ' + file + '  ->  ' + id);
    } catch (e) {
      console.error('skip ' + file + '  (' + e.message + ')');
    }
  }

  // Prune generated files whose original is gone.
  await prune(THUMB_DIR, keepThumb, '.webp');
  await prune(FULL_DIR, keepFull, '.jpg');

  await fs.writeFile(MANIFEST, JSON.stringify(manifest));
  console.log('\nmanifest.json written — ' + manifest.length + ' image(s).');
}

async function prune(dir, keep, ext) {
  let files = [];
  try { files = await fs.readdir(dir); } catch { return; }
  for (const f of files) {
    if (f.startsWith('.')) continue;
    if (path.extname(f).toLowerCase() === ext && !keep.has(f)) {
      await fs.unlink(path.join(dir, f));
      console.log('prune ' + path.basename(dir) + '/' + f);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
