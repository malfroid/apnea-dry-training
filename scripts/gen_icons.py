# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///

"""Generate PWA icons (192, 512, maskable 512) into ../icons/."""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).parent.parent / "icons"
OUT.mkdir(exist_ok=True)

BG = (15, 25, 35, 255)
FG = (224, 232, 240, 255)
ACCENT = (58, 123, 213, 255)


def make_icon(size: int, *, maskable: bool = False) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    # Maskable spec keeps content within the central 80% safe zone.
    pad = size * (0.22 if maskable else 0.12)
    inner = size - 2 * pad
    ring_w = max(2, int(inner * 0.07))
    d.ellipse([pad, pad, size - pad, size - pad], outline=FG, width=ring_w)
    inner_pad = size * (0.38 if maskable else 0.32)
    d.ellipse(
        [inner_pad, inner_pad, size - inner_pad, size - inner_pad],
        fill=ACCENT,
    )
    return img


for size in (192, 512):
    path = OUT / f"icon-{size}.png"
    make_icon(size).save(path, optimize=True)
    print(f"wrote {path}")

mask = OUT / "icon-maskable-512.png"
make_icon(512, maskable=True).save(mask, optimize=True)
print(f"wrote {mask}")
