"""
Builds every app icon from logo/applogo.jpg.

apps/mobile/android/ is gitignored (Capacitor regenerates it), so the icons
written there are not in the repo. This script is: rerun it after a fresh
clone or `npx cap add android`.

    python scripts/make-icons.py

The source is a 180px JPG, too small to upscale for a 432px adaptive icon
without a soft edge. So only the crescent's shape is taken from it, as a
coverage mask, and the icon is redrawn at each size in flat colours with a
clean edge.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'logo' / 'applogo.jpg'
RES = ROOT / 'apps' / 'mobile' / 'android' / 'app' / 'src' / 'main' / 'res'

NIGHT = (13, 16, 35)  # #0D1023, the tile
MOON = (138, 170, 255)  # #8AAAFF, the crescent

# Legacy icon edge in px, per density. The adaptive foreground is 2.25x this.
DENSITIES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
WORK = 2048  # the crescent is drawn this large, then scaled down


def crescent_mask() -> Image.Image:
    """The crescent as a WORK x WORK mask, in the source's own framing."""
    px = np.asarray(Image.open(SOURCE).convert('RGB')).astype(float)
    bg, fg = np.array(NIGHT, float), np.array(MOON, float)
    # How far each pixel sits between the tile colour and the moon colour.
    t = ((px - bg) @ (fg - bg)) / ((fg - bg) @ (fg - bg))
    # The white corners outside the tile also project high; drop them.
    t[(px.min(axis=2) > 200)] = 0
    # So does the light JPG fringe along the tile's own edge. The crescent
    # sits well inside it, so keep only the middle of the image.
    h, w = t.shape
    keep = np.zeros_like(t, dtype=bool)
    keep[h // 9 : h - h // 9, w // 9 : w - w // 9] = True
    t[~keep] = 0
    small = Image.fromarray((np.clip(t, 0, 1) * 255).astype(np.uint8))
    big = small.resize((WORK, WORK), Image.LANCZOS).filter(ImageFilter.GaussianBlur(WORK / 180))
    # Threshold at the midpoint for a hard shape, then a hair of blur so the
    # downscale antialiases it.
    hard = big.point(lambda v: 255 if v >= 128 else 0)
    return hard.filter(ImageFilter.GaussianBlur(2))


def moon_layer(mask: Image.Image, size: int, content: float) -> Image.Image:
    """Transparent square of `size` with the source framing scaled to `content` of it."""
    inner = max(1, round(size * content))
    layer = Image.new('RGBA', (size, size), MOON + (0,))
    alpha = Image.new('L', (size, size), 0)
    alpha.paste(mask.resize((inner, inner), Image.LANCZOS), ((size - inner) // 2,) * 2)
    layer.putalpha(alpha)
    return layer


def tile(size: int, radius: float) -> Image.Image:
    """The dark tile, drawn 4x and scaled down for a smooth corner."""
    s = size * 4
    img = Image.new('RGBA', (s, s), NIGHT + (0,))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, s - 1, s - 1), radius=radius * s, fill=NIGHT + (255,))
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    mask = crescent_mask()

    for density, size in DENSITIES.items():
        folder = RES / f'mipmap-{density}'
        # Pre-Oreo launchers: the rounded tile as drawn, and a circle.
        square = tile(size, 0.18)
        square.alpha_composite(moon_layer(mask, size, 1.0))
        square.save(folder / 'ic_launcher.png')
        rnd = tile(size, 0.5)
        rnd.alpha_composite(moon_layer(mask, size, 1.0))
        rnd.save(folder / 'ic_launcher_round.png')
        # Adaptive: a 108dp canvas of which the launcher shows the middle
        # 72dp, so the source framing takes 72/108 of it.
        fg = size * 108 // 48
        moon_layer(mask, fg, 72 / 108).save(folder / 'ic_launcher_foreground.png')

    (RES / 'values' / 'ic_launcher_background.xml').write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        '    <color name="ic_launcher_background">#0D1023</color>\n</resources>\n',
        encoding='utf-8',
    )

    # Android 12+ splash: the launcher icon on this colour instead of white.
    styles = RES / 'values' / 'styles.xml'
    text = styles.read_text(encoding='utf-8')
    if 'windowSplashScreenBackground' not in text:
        text = text.replace(
            '<item name="android:background">@drawable/splash</item>',
            '<item name="android:background">@drawable/splash</item>\n'
            '        <item name="windowSplashScreenBackground">@color/ic_launcher_background</item>',
        )
        styles.write_text(text, encoding='utf-8')

    # Pre-12 splash: the crescent centred on the night colour.
    for splash in RES.glob('drawable*/splash.png'):
        w, h = Image.open(splash).size
        edge = min(w, h) // 2
        img = Image.new('RGBA', (w, h), NIGHT + (255,))
        img.alpha_composite(moon_layer(mask, edge, 1.0), ((w - edge) // 2, (h - edge) // 2))
        img.convert('RGB').save(splash)

    # Web favicon, picked up by Next's app-router convention.
    icon = tile(512, 0.18)
    icon.alpha_composite(moon_layer(mask, 512, 1.0))
    icon.save(ROOT / 'apps' / 'web' / 'src' / 'app' / 'icon.png')

    print('[icons] launcher, splash and web icon written')


if __name__ == '__main__':
    main()
