"""
Play Store screenshots, 1080 x 1920 (9:16), from real emulator captures.

The phone captures are 1080 x 2340 (taller than 9:16, which Play rejects
beyond a 2:1 ratio). Each becomes a 9:16 image: a short caption on the app's
colour, and the real screen below with the status and navigation bars trimmed.

Run: python scripts/play-store/compose-screenshots.py <captures-folder>
Writes build/play-store/<app>/screenshots/NN.png
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "build" / "play-store"
BOLD = "C:/Windows/Fonts/segoeuib.ttf"

THEMES = {
    "customer": ((91, 14, 32), (245, 166, 35)),
    "partner": ((91, 14, 32), (245, 166, 35)),
    "rider": ((15, 120, 84), (255, 214, 102)),
}

SHOTS = {
    "customer": [
        ("c1-home", "Food from kitchens near you"),
        ("c2-list", "Real restaurants, real delivery times"),
        ("c3-menu", "Browse the menu, veg or non-veg"),
        ("c4-options", "Pick your size, add extras"),
        ("c5-bill", "A clear bill, no surprises"),
        ("c6-tracking", "Track your order live"),
    ],
    "partner": [
        ("p1-home", "See what you earn, every day"),
        ("p2-orders", "Accept and prepare orders fast"),
        ("p4-builder", "Photograph your menu, AI types it in"),
        ("p3-menu", "Keep your menu up to date"),
        ("p5-money", "Every rupee, order by order"),
    ],
    "rider": [
        ("r2-offer", "See your pay before you accept"),
        ("r3-trip", "Navigate to the customer"),
        ("r1-home", "Go online and start earning"),
        ("r4-earnings", "Your earnings and cash, clearly"),
    ],
}

W, H = 1080, 1920
TOP_TRIM, BOTTOM_TRIM = 118, 2208  # status bar above, navigation bar below


def wrap(draw, text, font, width):
    words, lines, line = text.split(), [], ""
    for w in words:
        test = (line + " " + w).strip()
        if draw.textlength(test, font=font) <= width:
            line = test
        else:
            lines.append(line)
            line = w
    lines.append(line)
    return lines


def compose(src: Path, caption: str, bg, accent, dest: Path):
    shot = Image.open(src).convert("RGB").crop((0, TOP_TRIM, 1080, BOTTOM_TRIM))
    canvas = Image.new("RGB", (W, H), bg)
    draw = ImageDraw.Draw(canvas)

    font = ImageFont.truetype(BOLD, 66)
    lines = wrap(draw, caption, font, W - 140)
    y = 90 if len(lines) == 1 else 60
    for line in lines:
        draw.text((W // 2, y), line, font=font, fill=(255, 255, 255), anchor="ma")
        y += 82
    draw.rounded_rectangle((W // 2 - 50, y + 14, W // 2 + 50, y + 22), radius=4, fill=accent)

    # The screen, scaled to the space left, with rounded corners and a soft shadow.
    top = 300
    avail_h = H - top - 60
    scale = avail_h / shot.height
    sw, sh = int(shot.width * scale), int(shot.height * scale)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    x = (W - sw) // 2
    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), radius=44, fill=255)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x + 6, top + 14, x + sw + 6, top + sh + 14), radius=44, fill=(0, 0, 0, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.paste(shadow, (0, 0), shadow)
    canvas.paste(shot, (x, top), mask)

    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "PNG", optimize=True)


if __name__ == "__main__":
    captures = Path(sys.argv[1])
    for app, items in SHOTS.items():
        bg, accent = THEMES[app]
        out = OUT / app / "screenshots"
        for old in out.glob("*.png") if out.exists() else []:
            old.unlink()
        for i, (name, caption) in enumerate(items, 1):
            src = captures / f"{name}.png"
            if not src.exists():
                print("missing", src)
                continue
            compose(src, caption, bg, accent, out / f"{i:02d}.png")
        print(app, len(list(out.glob('*.png'))), "screenshots")
