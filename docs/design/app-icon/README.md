# App icon: paper stack with the done check

![kan-do app icon](kan-do-icon.png)

The master is `kan-do-icon.png` (1024 × 1024 px, on the macOS icon grid) with its vector source `kan-do-icon.svg`. Everything in `src-tauri/icons/` and `public/favicon.*` is generated from it.

## Concept

A white task card on a stack of paper sheets, carrying one large green done check and no text. The stack and the check say "task, done"; the forest body and the paper sheets make it kan-do's. It holds at every size: at 32 and 16 px it still reads as a white card with a green check. Chosen by the user on 2026-11-24 (design round 6, variant G1) over the same icon with the name "Kan / do" on the card (2026-11-22), whose name only read from about 48 px. It replaced the yellow icon of #263.

## Values

- **Grid:** 1024 px canvas, body 824 × 824 px at a 100 px margin, corner radius 185 px, soft black drop shadow, y 10, blur 20 (the macOS template).
- **Body:** linear gradient top to bottom, forest-500 `#2C6940` → forest-800 `#15361F` (`custom-forest`, `assets/css/main.css`), with a white sheen from 16 % at the top to 0 at y 520.
- **Back sheets:** paper-100 (`#F3EFE6`, the paper canvas `--ui-page-bg`) at 90 % for the sheet directly behind the front card and 65 % for the one furthest back. They are flattened to the solid colours they give over the forest, `#E1E2D6` and `#B4C3B1`, so the sheets do not show through each other. Shadow forest-950 30 %, y 8, blur 22.
- **Front card:** white, 632 × 472 px at (196, 320), radius 72, shadow forest-950 40 %, y 18, blur 34.
- **Check:** centred on the front card at (512, 556): a forest-500 `#2C6940` disc, r 132, with a white tick (stroke 39, round caps and joins; points (448, 561), (497, 610), (580, 512)).
- **No type.** The in-app brand stays the text wordmark (`.app-nav-brand`).

## Regenerate

1. Edit `kan-do-icon.svg` in a vector editor and export `kan-do-icon.png` at 1024 × 1024. The icon was drawn in VectorCraft from a generator script, which is not in the repo (the VectorCraft file, generator and design rounds: `~/dev-workspace/design-archive/kan-do/app-icon-2026-11`, outside the repo).
2. App icons: `npm run tauri -- icon "$PWD/docs/design/app-icon/kan-do-icon.png"` (the cargo Tauri CLI; pass an absolute path). It rewrites every file in `src-tauri/icons/` and adds `64x64.png`, `android/` and `ios/`. Delete those three: there is no mobile target, and `tauri.conf.json` lists only `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` and `icon.ico`.
3. Favicons: `public/favicon.svg` is the master SVG cropped to the body (`viewBox="100 100 824 824"`). The two embedded raster gradients of the export are replaced by SVG `linearGradient`s with the values above, which keeps the file at about 4 kB. `public/favicon.ico` holds 48, 32 and 16 px, made from the master PNG cropped to the body: `magick kan-do-icon.png -crop 824x824+100+100 +repage -filter Lanczos \( -clone 0 -resize 48x48 \) \( -clone 0 -resize 32x32 \) \( -clone 0 -resize 16x16 \) -delete 0 public/favicon.ico`.
4. Web app icons and the share image: `node scripts/pwa-icons.mjs` renders them from `public/favicon.svg` with the repo's Playwright Chromium into `public/`: `icon-192.png` and `icon-512.png` (manifest purpose "any", the rounded body), `icon-maskable-192.png` and `icon-maskable-512.png` (full-bleed forest, the stack inside the 80 % safe circle), `apple-touch-icon.png` (180 px, full-bleed and opaque; iOS rounds it) and `og-image.png` (1200 × 630, the icon on paper-100, for link previews). `public/manifest.webmanifest` lists the manifest icons; `tests/config/web-manifest.test.ts` pins the fields and sizes.
