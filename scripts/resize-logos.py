#!/usr/bin/env python3
"""
Generate dashboard assets from the selected brand masters.

Root logo.png is the transparent foreground for sidebar and browser marks.
assets/brand/icon.png and icon-rounded.png supply touch and social images.

Meowth is a Vite SPA (not Next.js), so derivatives land in
apps/dashboard/public/ where Vite exposes them at the site root
(e.g. /logo-24.png). The dashboard is embedded into the daemon
binary via go:embed at prod build time, so a fresh
`pnpm daemon:build` after running this script ships the new icons.

Usage:
    python3 scripts/resize-logos.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "logo.png"
ICON = ROOT / "assets" / "brand" / "icon.png"
ROUNDED = ROOT / "assets" / "brand" / "icon-rounded.png"
PUBLIC = ROOT / "apps" / "dashboard" / "public"

# Background colour for the OG card. Matches the dark "L0 background"
# token from the basalt B-5 palette (#171717).
OG_BACKGROUND = (23, 23, 23, 255)


def resize_square(img: Image.Image, size: int) -> Image.Image:
    """High-quality square resize using Lanczos resampling."""
    return img.resize((size, size), Image.LANCZOS)


def create_og_image(img: Image.Image, width: int = 1200, height: int = 630) -> Image.Image:
    """Centered logo on a dark canvas, 1200x630 RGB."""
    bg = Image.new("RGBA", (width, height), OG_BACKGROUND)
    logo_size = int(height * 0.6)  # 378 px tall — leaves comfortable margin
    logo = resize_square(img, logo_size)
    x = (width - logo_size) // 2
    y = (height - logo_size) // 2
    bg.paste(logo, (x, y), logo)
    return bg.convert("RGB")


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Source logo not found: {SOURCE}")

    img = Image.open(SOURCE).convert("RGBA")
    print(f"Source: {SOURCE.relative_to(ROOT)} ({img.size[0]}x{img.size[1]})")

    PUBLIC.mkdir(parents=True, exist_ok=True)

    # Responsive sources for BrandMark, all with transparent backgrounds.
    for size in (24, 80, 192):
        out = PUBLIC / f"logo-{size}.png"
        resize_square(img, size).save(out, "PNG")
        print(f"  {out.relative_to(ROOT)} ({size}x{size})")

    # Pillow derives every ICO entry from the full-size transparent master.
    ico_path = PUBLIC / "favicon.ico"
    img.save(ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  {ico_path.relative_to(ROOT)} (16+32+48 multi-size)")

    # Apple touch icon (iOS Safari pinned shortcut).
    apple_path = PUBLIC / "apple-touch-icon.png"
    with Image.open(ICON) as icon:
        resize_square(icon.convert("RGB"), 180).save(apple_path, "PNG")
    print(f"  {apple_path.relative_to(ROOT)} (180x180)")

    # OG card for social previews of meowth.dev.hexly.ai and the
    # GitHub repo page.
    og_path = PUBLIC / "og-image.png"
    with Image.open(ROUNDED) as rounded:
        create_og_image(rounded.convert("RGBA")).save(og_path, "PNG")
    print(f"  {og_path.relative_to(ROOT)} (1200x630)")

    print("\nDone.")


if __name__ == "__main__":
    main()
