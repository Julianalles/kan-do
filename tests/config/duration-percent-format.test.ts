import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// #598 (guard 106): durations and percent values reach the user only through `utils/localeFormat.ts`
// (`formatDuration`, `formatPercent`). A component that builds "12 min" or "60 %" by hand drifts from the locale spacing
// ("60 %" in German, "60%" in English) and from the one duration shape. Comments and doc blocks are removed first.
// CSS lengths (`height: ${n}%`) are not a user-facing percent and are skipped.
// Scope: component and TS source only; percent written inside i18n locale strings (`{share} %`) is not scanned.
const root = resolve(__dirname, '../..')
const SCANNED = ['components', 'pages', 'composables', 'layouts', 'lib', 'store']

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(vue|ts)$/.test(path) ? [path] : []
  })
}

function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

/** An interpolated value followed by a percent sign or a duration unit: `${n}%`, `{{ n }} %`, `${m} min`. */
const HAND_FORMATTED = /(?:\$\{[^}]*\}|\}\})\s?(?:%|min\b|h\b)/
const CSS_LENGTH = /(?:height|width|left|right|top|bottom|flex-basis|--[\w-]+)['"]?\s*:\s*[^;]*$/

/** Places that keep a hand-written form, with the reason. Empty on purpose. */
const ALLOWED: Record<string, string> = {
  'lib/inkRamp.ts': 'builds CSS colour channels (`oklch(… ${l}%)`), not user-facing text',
}

export function offenders(source: string): string[] {
  return stripComments(source)
    .split('\n')
    .filter((line) => HAND_FORMATTED.test(line))
    .filter((line) => {
      const before = line.slice(0, line.search(HAND_FORMATTED) + 1)
      return !CSS_LENGTH.test(before) && !/\bwidth\b|\bheight\b/.test(line.replace(/class="[^"]*"/g, ''))
    })
}

describe('duration and percent go through the shared formatter (#598)', () => {
  it('no component formats minutes or percent by hand', () => {
    const found = SCANNED.flatMap((dir) => files(join(root, dir)))
      .filter((path) => !ALLOWED[relative(root, path)])
      .flatMap((path) => offenders(readFileSync(path, 'utf8')).map((line) => `${relative(root, path)}: ${line.trim()}`))
    expect(found).toEqual([])
  })

  it('catches the places the sweep fixed when they are put back', () => {
    expect(offenders('h(\'div\', {}, `${Math.round(accuracy)}%`)')).not.toEqual([])
    expect(offenders('<span>{{ Math.round(item.value) }} %</span>')).not.toEqual([])
    expect(offenders('const s = `${hours}h ${minutes}min`')).not.toEqual([])
    expect(offenders(':style="{ height: `${Math.max(week.share, 3)}%` }"')).toEqual([])
  })
})
