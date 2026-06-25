#!/usr/bin/env python3
"""
Generate all logo derivatives from root logo.png.

Single-source pattern: one high-res logo (2048x2048 RGBA) → multiple
sizes for favicon, sidebar, Apple touch icon, OG image, etc.

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

    # In-app references (sidebar small icon, large display, and the
    # 192px standard PWA / share-card asset added in Phase 2
    # redesign Stage B2 even though no live consumer ships yet).
    for size in (24, 80, 192):
        out = PUBLIC / f"logo-{size}.png"
        resize_square(img, size).save(out, "PNG")
        print(f"  {out.relative_to(ROOT)} ({size}x{size})")

    # Browser favicon (multi-size ICO, 16 + 32).
    ico_16 = resize_square(img, 16)
    ico_32 = resize_square(img, 32)
    ico_path = PUBLIC / "favicon.ico"
    ico_16.save(ico_path, format="ICO", sizes=[(16, 16), (32, 32)], append_images=[ico_32])
    print(f"  {ico_path.relative_to(ROOT)} (16+32 multi-size)")

    # Apple touch icon (iOS Safari pinned shortcut).
    apple_path = PUBLIC / "apple-touch-icon.png"
    resize_square(img, 180).save(apple_path, "PNG")
    print(f"  {apple_path.relative_to(ROOT)} (180x180)")

    # OG card for social previews of meowth.dev.hexly.ai and the
    # GitHub repo page.
    og_path = PUBLIC / "og-image.png"
    create_og_image(img).save(og_path, "PNG")
    print(f"  {og_path.relative_to(ROOT)} (1200x630)")

    print("\nDone.")


if __name__ == "__main__":
    main()
