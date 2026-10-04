"""
Play Store graphics for the three public apps (owner, 4 Oct 2026).

  build/play-store/<app>/icon-512.png            512 x 512, 32-bit PNG
  build/play-store/<app>/feature-graphic.png     1024 x 500, 24-bit PNG (no alpha)

Made from each app's own launcher icon, so the store matches the phone.
Run: python scripts/play-store/make-graphics.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "build" / "play-store"
FONTS = Path("C:/Windows/Fonts")
BOLD = str(FONTS / "segoeuib.ttf")
REGULAR = str(FONTS / "segoeui.ttf")

APPS = {
    "customer": {
        "src": "apps/customer-mobile/assets/icon.png",
        # The customer icon is the full-colour logo on white; it already fills the frame.
        "crop": None,
        "bg": (91, 14, 32),
        "bg2": (140, 24, 52),
        "accent": (245, 166, 35),
        "title": "Quick Bites",
        "lines": ["Food from your favourite local kitchens,", "delivered fast. Track every order live."],
        "logo_on_card": True,
    },
    "partner": {
        "src": "apps/restaurant-mobile/assets/icon.png",
        # White logo small in the middle of a maroon square: enlarged for the store.
        "crop": (232, 232, 792, 792),
        "bg": (91, 14, 32),
        "bg2": (122, 22, 46),
        "accent": (245, 166, 35),
        "title": "Quick Bites Partner",
        "lines": ["Take orders, run your menu and", "see every rupee you earn."],
        "logo_on_card": False,
    },
    "rider": {
        "src": "apps/delivery-mobile/assets/icon.png",
        "crop": (232, 232, 792, 792),
        "bg": (15, 138, 95),
        "bg2": (11, 104, 72),
        "accent": (255, 214, 102),
        "title": "Quick Bites Rider",
        "lines": ["Deliver with Quick Bites.", "Paid for every km, plus your tips."],
        "logo_on_card": False,
    },
}


def gradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", size, top)
    px = img.load()
    for x in range(w):
        t = x / (w - 1)
        col = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for y in range(h):
            px[x, y] = col
    return img


def make(app, spec):
    out = OUT / app
    out.mkdir(parents=True, exist_ok=True)
    src = Image.open(ROOT / spec["src"]).convert("RGBA")

    # --- 512 icon -------------------------------------------------------
    icon = src.crop(spec["crop"]) if spec["crop"] else src
    icon = icon.resize((512, 512), Image.LANCZOS)
    icon.save(out / "icon-512.png", "PNG", optimize=True)

    # --- 1024 x 500 feature graphic --------------------------------------
    fg = gradient((1024, 500), spec["bg"], spec["bg2"])
    draw = ImageDraw.Draw(fg)

    # The logo, on a rounded white card for the full-colour customer logo,
    # or as the coloured tile itself for partner and rider.
    tile = 300
    tx, ty = 90, 100
    if spec["logo_on_card"]:
        card = Image.new("RGBA", (tile, tile), (0, 0, 0, 0))
        ImageDraw.Draw(card).rounded_rectangle((0, 0, tile - 1, tile - 1), radius=60, fill=(255, 255, 255, 255))
        logo = src.resize((tile - 40, tile - 40), Image.LANCZOS)
        card.alpha_composite(logo, (20, 20))
    else:
        logo = icon.resize((tile, tile), Image.LANCZOS)
        mask = Image.new("L", (tile, tile), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, tile - 1, tile - 1), radius=60, fill=255)
        card = Image.new("RGBA", (tile, tile), (0, 0, 0, 0))
        card.paste(logo, (0, 0), mask)
        ring = ImageDraw.Draw(card)
        ring.rounded_rectangle((0, 0, tile - 1, tile - 1), radius=60, outline=(255, 255, 255, 90), width=4)
    fg.paste(card, (tx, ty), card)

    # Text, kept inside Google's safe area (clear of the edges).
    x = 450
    title_font = ImageFont.truetype(BOLD, 64 if len(spec["title"]) <= 12 else 54)
    body_font = ImageFont.truetype(REGULAR, 30)
    draw.text((x, 150), spec["title"], font=title_font, fill=(255, 255, 255))
    draw.rectangle((x, 238, x + 90, 244), fill=spec["accent"])
    for i, line in enumerate(spec["lines"]):
        draw.text((x, 268 + i * 44), line, font=body_font, fill=(255, 241, 224))

    fg.save(out / "feature-graphic.png", "PNG", optimize=True)
    print(app, "icon", Image.open(out / "icon-512.png").size, "feature", fg.size)


if __name__ == "__main__":
    for name, spec in APPS.items():
        make(name, spec)
