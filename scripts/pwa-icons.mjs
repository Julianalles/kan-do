#!/usr/bin/env node
// Renders the web app icons and the share image from `public/favicon.svg` (the app icon cropped to its body,
// docs/design/app-icon/README.md) with the repo's Playwright Chromium, so the SVG filters render as in a browser.
// Run after the icon changes: `node scripts/pwa-icons.mjs`. Output (all in `public/`):
//   icon-192.png, icon-512.png          purpose "any": the rounded body, transparent corners (as the favicon)
//   icon-maskable-192.png, -512.png     purpose "maskable": full-bleed forest, the stack inside the 80 % safe circle
//   apple-touch-icon.png (180)          full-bleed square, opaque; iOS rounds the corners itself
//   og-image.png (1200 x 630)           the icon centred on the paper canvas (paper-100), for link previews
// Sizes and manifest fields are pinned by tests/config/web-manifest.test.ts.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url))
const favicon = readFileSync(pub('favicon.svg'), 'utf8')

// The favicon draws the body and its sheen through the rounded clip paths and an outer drop shadow (`filter-1`).
// A full-bleed variant drops both and paints the body square over the whole view box.
function fullBleed(viewBox) {
  const [x, y, w, h] = viewBox.split(' ').map(Number)
  return favicon
    .replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`)
    .replace(/<g filter="url\(#filter-1\)"><g><g clip-path="url\(#clip-path-1\)"><rect [^>]*\/><\/g><\/g><\/g>/,
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#body)"/>`)
    .replace(/<g><g clip-path="url\(#clip-path-2\)"><rect [^>]*\/><\/g><\/g>/,
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#sheen)"/>`)
}

// The farthest drawn point of the stack lies about 430 units from the body centre (512, 512). A maskable icon keeps
// its content inside a circle of 40 % of its size, so the view box is 1100 units (radius 440), centred on the body.
const MASKABLE = fullBleed('-38 -38 1100 1100')
const SQUARE = fullBleed('100 100 824 824')
if (!MASKABLE.includes('<rect x="-38"') || !SQUARE.includes('<rect x="100" y="100" width="824" height="824" fill="url(#sheen)"/>') || MASKABLE.includes('clip-path-1)')) {
  throw new Error('favicon.svg changed its structure: update fullBleed() in scripts/pwa-icons.mjs')
}

const PAPER = '#f3efe6'
// Behind the full-bleed icons, never visible: an opaque page makes the PNG opaque (iOS fills transparency with black).
const FOREST = '#15361f'
const dataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })

async function render(file, { svg, width, height = width, iconSize = width, background }) {
  await page.setViewportSize({ width, height })
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${width}px;height:${height}px;display:grid;place-items:center;background:${background ?? 'transparent'}">
    <img src="${dataUrl(svg)}" width="${iconSize}" height="${iconSize}" style="display:block${iconSize < width ? ';filter:drop-shadow(0 12px 28px rgb(23 19 14 / 0.18))' : ''}"></body></html>`)
  await page.locator('img').evaluate((img) => img.decode())
  writeFileSync(pub(file), await page.screenshot({ omitBackground: !background }))
  console.log(`public/${file} ${width}x${height}`)
}

for (const size of [192, 512]) {
  await render(`icon-${size}.png`, { svg: favicon, width: size })
  await render(`icon-maskable-${size}.png`, { svg: MASKABLE, width: size, background: FOREST })
}
await render('apple-touch-icon.png', { svg: SQUARE, width: 180, background: FOREST })
// Share image: the icon at 360 px on paper, centred; the name is on the icon's card.
await render('og-image.png', { svg: favicon, width: 1200, height: 630, iconSize: 360, background: PAPER })

await browser.close()
