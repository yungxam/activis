// Build the IMAGES gallery.
//
// For every file in gallery/originals/ this produces:
//   gallery/thumbs/<id>.webp  (small grid thumbnail)
//   gallery/full/<id>.jpg     (downscaled full-size for the lightbox)
// and merges an entry into gallery/manifest.json (the list the desktop reads).
//
// Originals are "consumed": after a file is successfully processed it is
// DELETED from gallery/originals/. Only the small optimized versions are kept
// and served, so the repo stays lean and scales to hundreds of images. Keep
// your own copies of the originals — the repo doesn't retain them.
//
// The manifest ACCUMULATES: existing entries are preserved and new/re-uploaded
// ones are merged in, so you can add images in batches over time.
//
// Run locally with `npm install && npm run build:gallery`, or let the GitHub
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
const KEEP = new Set(['.gitkeep', 'README.md']); // never delete these from originals/

function slugify(name) {
  return name.replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'img';
}

function naturalCmp(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

async function main() {
  await fs.mkdir(THUMB_DIR, { recursive: true });
  await fs.mkdir(FULL_DIR, { recursive: true });

  // Load existing manifest so batches accumulate.
  const byId = new Map();
  try {
    const prev = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
    if (Array.isArray(prev)) for (const it of prev) if (it && it.id) byId.set(it.id, it);
  } catch { /* no manifest yet */ }

  let files = [];
  try {
    files = (await fs.readdir(SRC))
      .filter((f) => !f.startsWith('.') && EXT.has(path.extname(f).toLowerCase()))
      .sort(naturalCmp);
  } catch {
    console.log('No gallery/originals/ directory.');
  }

  let added = 0, skipped = 0;
  const usedIds = new Set(byId.keys());

  for (const file of files) {
    // Stable id from filename; if it collides with a different existing file, suffix it.
    let id = slugify(file), base = id, n = 2;
    while (usedIds.has(id) && !sameSource(byId.get(id), file)) id = base + '-' + (n++);
    usedIds.add(id);

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

      byId.set(id, {
        id: id,
        src: file,
        thumb: 'thumbs/' + thumbName,
        full: 'full/' + fullName,
        w: info.width,
        h: info.height,
        alt: id.replace(/[-_]+/g, ' ').trim()
      });

      // Consume the original.
      await fs.unlink(src);
      added++;
      console.log('ok   ' + file + '  ->  ' + id);
    } catch (e) {
      skipped++;
      console.error('skip ' + file + '  (' + e.message + ')');
    }
  }

  const manifest = Array.from(byId.values()).sort((a, b) => naturalCmp(a.src || a.id, b.src || b.id));
  await fs.writeFile(MANIFEST, JSON.stringify(manifest));
  console.log('\nmanifest.json: ' + manifest.length + ' image(s) total (' + added + ' new, ' + skipped + ' skipped).');
}

function sameSource(entry, file) {
  return entry && entry.src === file;
}

main().catch((e) => { console.error(e); process.exit(1); });
