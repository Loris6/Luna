#!/usr/bin/env python3
"""Erzeugt alle Logo-/App-Icons aus icons/logo-original.png (Pillow nötig: pip install pillow).

- icons/logo-mark-*.png   Logo OHNE Hintergrund (transparent) – z. B. für .luna-Dateien
- icons/icon-*.png, apple-touch-icon.png, favicon-32.png   App-Icons mit weißem Hintergrund (RGB 255,255,255)
- icons/maskable-512.png  Android-Icon mit Sicherheitsabstand
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / 'icons'
src = Image.open(ROOT / 'logo-original.png').convert('RGB')
PURPLE = (77, 0, 81)

alpha = src.getchannel('G').point(lambda v: 255 - v)   # Weiß → transparent, Lila → deckend
mark = Image.new('RGBA', src.size, PURPLE + (0,))
mark.putalpha(alpha)
mark = mark.crop(alpha.point(lambda v: 255 if v > 8 else 0).getbbox())

side = max(mark.size)
square = Image.new('RGBA', (side, side), PURPLE + (0,))
square.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2), mark)
for size in (32, 64, 128, 256, 512):
    square.resize((size, size), Image.LANCZOS).save(ROOT / f'logo-mark-{size}.png', optimize=True)


def icon(size, scale, name):
    bg = Image.new('RGBA', (size, size), (255, 255, 255, 255))
    w = int(size * scale)
    h = int(w * mark.height / mark.width)
    bg.alpha_composite(mark.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    bg.convert('RGB').save(ROOT / name, optimize=True)


icon(1024, 0.62, 'icon-1024.png')
icon(512, 0.62, 'icon-512.png')
icon(192, 0.62, 'icon-192.png')
icon(512, 0.50, 'maskable-512.png')
icon(180, 0.58, 'apple-touch-icon.png')
icon(32, 0.80, 'favicon-32.png')
print('Icons erzeugt in', ROOT)
