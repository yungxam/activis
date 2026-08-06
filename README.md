# activis

A first-person, PS2-era low-poly desk scene built with Three.js. Click the
monitor to fly into the screen and land on a Windows 95-style desktop
(gallery, notepad, recycle bin, and a few easter eggs).

## Running locally
Any static file server works, e.g.:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

## Structure
- `index.html` — entry point
- `css/` — styles
- `js/` — app + baked image sprites
- `vendor/` — three.js (vendored)
- `assets/` — scene textures/photos
- `gallery/` — the IMAGES gallery (thumbs + full + manifest, generated)
- `tools/` — build scripts

## Deploy
Served as a static site via GitHub Pages.
