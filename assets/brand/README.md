# Meowth brand assets

The silver-blue American Shorthair with a colorful yarn loop comes from
hexly.ai study `2026-09-07-01`, finishing `02`. This is the latest completed
selection; the subsequent paused redraws returned no replacement artwork.
Source adoption was requested on 2026-09-08.

Source directory in the sibling hexly.ai checkout:
`public/logos/family/meowth/2026-09-07-01/02/`.
The [complete archive](https://github.com/nocoo/hexly.ai/tree/main/artwork/logo-family/meowth/2026-09-07-01)
retains the previous original, source decision, finishing settings, and exports.
The [individual review](https://index.dev.hexly.ai/logos/meowth) and archived
`review.html` show the selected composition and small-size specimens.

## Exact masters

All three masters retain their original 2048 × 2048 canvas and bytes.

| Local file | Source file | SHA-256 |
| --- | --- | --- |
| `logo.png` at repository root | `transparent.png` | `5d7236bab120c37ab93a929d182708bc1c07da14285925be50c95e868e6ec378` |
| `assets/brand/icon.png` | `icon.png` | `2a6411110cd68b6a5b38bbefe9325d515276e7f50ec257d8c6a5520bc6d4b10a` |
| `assets/brand/icon-rounded.png` | `rounded.png` | `99eb2aaff6616232bb87e56170631349957dd72f7f2506f8daf001a55373aed4` |

## Consumers

| Surface | Asset | Treatment |
| --- | --- | --- |
| Expanded/collapsed/mobile sidebar, setup, loading | `apps/dashboard/public/logo-{24,80,192}.png` through `apps/dashboard/src/components/BrandMark.tsx` | Transparent foreground; no image crop or added tile in BrandMark |
| Browser tab | `apps/dashboard/public/favicon.ico` | Transparent foreground in every 16, 32, and 48 px entry |
| Apple touch icon | `apps/dashboard/public/apple-touch-icon.png` | Opaque 180 px square presentation; iOS applies its own mask |
| Open Graph | `apps/dashboard/public/og-image.png` | Rounded presentation centered on the existing 1200 × 630 dark canvas |
| Root README | `assets/brand/icon-rounded.png` | Selected presentation at 128 px |

Sidebar headers keep the same uncropped foreground in light/dark themes and
expanded/collapsed states. Preserve the complete canvas, colors, and proportions
when resizing. Do not add a background, circular crop, or glow to small marks.

## Regeneration and verification

Run `python3 scripts/resize-logos.py` with Pillow installed, or use an isolated
environment: `uv run --no-project --with pillow python scripts/resize-logos.py`.
The script generates all six public derivatives. The favicon must be saved from
the full transparent master so Pillow includes every requested resolution.

`apps/dashboard/index.html` and `BrandMark.tsx` use source-hash query strings
because embedded root assets have immutable cache headers. Update these strings
when replacing a master. Check master SHA-256 values, derivative dimensions,
PNG/ICO alpha, and light/dark sidebar rendering after regeneration.

Vite serves the new assets at `https://meowth.dev.hexly.ai`. An embedded release
uses `pnpm daemon:build`; restarting the development daemon is unnecessary for
Vite asset changes. A local adoption commit does not imply publication.

Verification on 2026-09-08 confirmed exact master bytes, transparent PNGs and all
three ICO resolutions, an opaque touch icon, and the social image dimensions.
Four existing browser checks passed across light/dark themes, covering all
dashboard pages and centered collapsed navigation. Screenshots and an asset
contact sheet were inspected. HTTPS and an isolated rebuilt daemon returned
all six derivatives byte-for-byte; `daemon/internal/server/server.go` now also
serves the 192 px source used by high-density displays.
