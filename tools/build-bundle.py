#!/usr/bin/env python3
"""Build noname-bundle.html — the single-file Artifact preview of the site.

Inlines fonts (tools/fonts.css), styles, markup, all JS (three.js + sprites +
main), and embeds the beer audio as a data URI. Run from the repo root:
    python3 tools/build-bundle.py
"""
import re, os, base64

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def rd(p): return open(os.path.join(base, p), encoding='utf-8').read()

font_css = rd('tools/fonts.css')
html = rd('index.html')
css = rd('css/style.css')
beer_audio = base64.b64encode(open(os.path.join(base, 'assets/beer-drink.mp3'), 'rb').read()).decode()
audio_shim = "window.BEER_AUDIO='data:audio/mpeg;base64,%s';" % beer_audio

scripts = ['vendor/three.min.js', 'js/hand-sprite.js', 'js/beer-sprite.js',
           'js/poster-sprite.js', 'js/poster2-sprite.js', 'js/photo-sprite.js',
           'js/pad-sprite.js', 'js/mail-icon.js', 'js/logo-sprite.js', 'js/main.js']
js_all = audio_shim + '\n' + '\n'.join('/*==== %s ====*/\n%s' % (s, rd(s)) for s in scripts)

body = html
body = re.sub(r'<link rel="preconnect"[^>]*>\s*', '', body)
body = re.sub(r'<link href="https://fonts\.googleapis[^>]*>\s*', '', body)
body = body.replace('<link rel="stylesheet" href="./css/style.css">', '')
body = re.sub(r'<link rel="icon"[^>]*>\s*', '', body)
body = re.sub(r'<link rel="apple-touch-icon"[^>]*>\s*', '', body)
body = re.sub(r'<script src="[^"]*"></script>\s*', '', body)
markup = re.search(r'<body>(.*)</body>', body, re.S).group(1).strip()

out = '<style>\n%s\n%s\n</style>\n%s\n<script>\n%s\n</script>' % (font_css, css, markup, js_all)
dst = os.path.join(base, 'noname-bundle.html')
open(dst, 'w', encoding='utf-8').write(out)
print('bundle rebuilt:', os.path.getsize(dst), 'bytes')
