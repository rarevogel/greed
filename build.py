#!/usr/bin/env python3
"""Builds one self-contained greed.html (fonts and code inlined) and copies it into the Android app."""
import base64, os, re, shutil
here = os.path.dirname(os.path.abspath(__file__))
web = os.path.join(here, 'web')
fs = os.path.join(here, 'node_modules', '@fontsource')

def font(family, path, weight):
    data = base64.b64encode(open(os.path.join(fs, path), 'rb').read()).decode()
    return f"@font-face{{font-family:'{family}';font-weight:{weight};font-display:block;src:url(data:font/woff2;base64,{data}) format('woff2')}}"

fonts = '\n'.join([
    font('VT323', 'vt323/files/vt323-latin-400-normal.woff2', 400),
    font('IBM Plex Mono', 'ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 400),
    font('IBM Plex Mono', 'ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', 600),
])
game = re.sub(r'^export ', '', open(os.path.join(web, 'game.js')).read(), flags=re.M)
app = open(os.path.join(web, 'app.js')).read()
html = open(os.path.join(web, 'index.html')).read()
html = html.replace('/*@FONTS*/', fonts).replace('/*@SCRIPT*/', game + '\n' + app)
os.makedirs(os.path.join(here, 'dist'), exist_ok=True)
out = os.path.join(here, 'dist', 'greed.html')
open(out, 'w').write(html)
assets = os.path.join(here, 'android', 'assets')
os.makedirs(assets, exist_ok=True)
shutil.copy(out, os.path.join(assets, 'index.html'))
print(out, len(html))
