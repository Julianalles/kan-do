import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { OVERLAY_ACTIONS, OVERLAY_ACTION_EVENT, OVERLAY_LABEL, OVERLAY_STATE_EVENT } from '../../lib/nowWindow'
import { OVERLAY_PATH } from '../../lib/overlayWindow'

// Drift guard for the floating Now window (#383, ADR 020): the Rust side (`overlay.rs`) and the web side
// (`lib/nowWindow.ts`) share a label, two event names and the action allow-list; the pill window gets the smallest
// capability there is; and it must never be able to touch the data file.

const root = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const rust = read('src-tauri/src/overlay.rs')
const dataFile = read('src-tauri/src/data_file.rs')

describe('overlay contract: names shared with Rust', () => {
  it('uses the same label and event names', () => {
    expect(rust).toContain(`pub const OVERLAY_LABEL: &str = "${OVERLAY_LABEL}";`)
    expect(rust).toContain(`pub const STATE_EVENT: &str = "${OVERLAY_STATE_EVENT}";`)
    expect(rust).toContain(`pub const ACTION_EVENT: &str = "${OVERLAY_ACTION_EVENT}";`)
  })

  it('lists the same actions in Rust and TypeScript', () => {
    const block = /pub const OVERLAY_ACTIONS: &\[&str\] = &\[([\s\S]*?)\];/.exec(rust)?.[1] ?? ''
    const ids = [...block.matchAll(/"([^"]+)"/g)].map(m => m[1])
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toEqual([...OVERLAY_ACTIONS])
  })

  it('opens the window at the route the web side switches on', () => {
    expect(rust).toContain(`WebviewUrl::App("${OVERLAY_PATH.slice(1)}".into())`)
  })

  it('registers its commands', () => {
    const lib = read('src-tauri/src/lib.rs')
    for (const command of ['overlay_sync', 'overlay_ready', 'overlay_action']) expect(lib).toContain(`overlay::${command},`)
  })

  it('needs the macOS private API for the transparent window, on both sides of the build check', () => {
    const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as { app: { macOSPrivateApi?: boolean } }
    expect(conf.app.macOSPrivateApi).toBe(true)
    expect(read('src-tauri/Cargo.toml')).toMatch(/tauri = \{[^}]*"macos-private-api"/)
  })
})

describe('overlay contract: the pill is system glass and shows whichever window has the focus (#436)', () => {
  it('builds the window with Liquid Glass and a vibrancy fallback, on a transparent window', () => {
    expect(rust).toMatch(/\.transparent\(true\)\s*\.effects\(glass\(\)\)/)
    expect(rust).toContain('WindowEffect::LiquidGlassRegular, WindowEffect::HudWindow')
  })

  it('is 280 x 42 pt and the pill\'s CSS box says the same (#703)', () => {
    const num = (name: string) => Number(new RegExp(`const ${name}: f64 = ([\\d.]+);`).exec(rust)?.[1])
    expect([num('WINDOW_WIDTH'), num('WINDOW_HEIGHT')]).toEqual([280, 42])
    const css = read('components/overlay/NowWindow.vue')
    expect(css).toMatch(/\.now-window \{[^}]*\n {2}width: 280px;\n {2}height: 42px;/)
    // the light's way and the glint's way are computed from the width again (#812): it must not drift from the box
    expect(css).toMatch(/\.now-window \{[^}]*--now-w: 280px;/)
  })

  it('keeps the glass corner radius a capsule: half the window height, as the pill\'s CSS radius says', () => {
    const height = Number(/const WINDOW_HEIGHT: f64 = ([\d.]+);/.exec(rust)?.[1])
    const radius = Number(/const CORNER_RADIUS: f64 = ([\d.]+);/.exec(rust)?.[1])
    expect(radius).toBe(height / 2)
  })

  it('clips glass, web view and shadow with one circular mask on the content view, so the capsule ends are not cut (#565)', () => {
    expect(rust).toMatch(/make_non_activating\(&window\);\s*round_corners\(&window\);/)
    const mask = /fn round_corners<R: Runtime>\(window: &WebviewWindow<R>\) \{[\s\S]*?\n\}\n/.exec(rust)?.[0] ?? ''
    for (const message of ['contentView', 'setCornerRadius: CORNER_RADIUS', 'setCornerCurve:', '"circular"', 'setMasksToBounds: true', 'invalidateShadow']) {
      expect(mask, message).toContain(message)
    }
    // the pill's own capsule is the same arc: 9999px clamps to half the 42 px box, the glass radius
    expect(read('components/overlay/NowWindow.vue')).toContain('--now-radius: 9999px;')
  })

  it('makes the window non-activating on macOS, so a press does not raise kan-do or take the keyboard focus', () => {
    expect(rust).toContain('NSWindowStyleMask::NonactivatingPanel')
    expect(rust).toContain('_setPreventsActivation:')
    expect(rust).toMatch(/make_non_activating\(&window\);/)
    expect(rust).toMatch(/\.focusable\(false\)[\s\S]*\.accept_first_mouse\(true\)/)
  })

  it('does not look at the main window\'s focus to decide whether to show', () => {
    expect(rust).not.toContain('main_focused')
    expect(rust).not.toContain('on_main_focus')
    expect(read('src-tauri/src/lib.rs')).not.toContain('on_main_focus')
  })
})

describe('overlay contract: the pill window is least-privileged', () => {
  const capability = JSON.parse(read('src-tauri/capabilities/overlay.json')) as { windows: string[]; permissions: Array<string | { identifier: string }> }

  it('belongs to the overlay window only and is not granted to main', () => {
    expect(capability.windows).toEqual([OVERLAY_LABEL])
    const main = JSON.parse(read('src-tauri/capabilities/default.json')) as { windows: string[] }
    expect(main.windows).not.toContain(OVERLAY_LABEL)
  })

  it('grants only event listening and dragging itself', () => {
    expect(capability.permissions).toEqual(['core:event:default', 'core:window:allow-start-dragging'])
  })
})

describe('overlay contract: the pill window never reaches the data file (ADR 011)', () => {
  it('every data command refuses a window that is not main', () => {
    const commands = [...dataFile.matchAll(/#\[tauri::command\]\s*pub async fn (data_\w+)\(([\s\S]*?)\) -> [\s\S]*?\{\n([^\n]*)/g)]
    // every command is matched: none slipped past the pattern
    expect(commands.length).toBe([...dataFile.matchAll(/pub async fn data_\w+\(/g)].length)
    expect(commands.length).toBeGreaterThanOrEqual(18)
    for (const [, name, params, firstLine] of commands) {
      expect(params, name).toContain('window: tauri::Window')
      expect(firstLine, name).toContain('ensure_main_window(&window)?;')
    }
  })

  it('only the main window label passes', () => {
    expect(dataFile).toContain('pub const DATA_WINDOW_LABEL: &str = "main";')
  })

  // A client plugin runs in the pill window too. Each one either returns early there (`isOverlayWindow()`), or is on
  // this list because it reads and writes nothing that matters: a new plugin lands in one of the two on purpose.
  const HARMLESS = new Map([
    ['pinia.ts', 'creates the store container; no store is ever used in the pill window'],
    ['board-place.client.ts', 'mirrors the route path into a module variable'],
    ['component-name.client.ts', 'marks component root elements'],
    ['copy-editor-recorder.client.ts', 'dev tool hook; no data'],
    ['desktop-shell.client.ts', 'sets data-shell and window-drag listeners'],
    ['i18n-locale.client.ts', 'resolves the UI language from localStorage kando-locale; the snapshot overrides it'],
    ['route-arrival.client.ts', 'notes navigations in a module variable'],
    ['scrollbar-gutter.client.ts', 'measures the scrollbar'],
  ])
  it('every client plugin guards on isOverlayWindow() or is listed as harmless', () => {
    for (const file of readdirSync(resolve(root, 'plugins')).filter(name => name.endsWith('.ts'))) {
      const guarded = read(`plugins/${file}`).includes('isOverlayWindow()')
      expect(guarded || HARMLESS.has(file), `plugins/${file} runs in the floating Now window: guard it with isOverlayWindow() or list it as harmless`).toBe(true)
    }
  })
})
