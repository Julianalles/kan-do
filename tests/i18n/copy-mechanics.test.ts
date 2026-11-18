import { describe, expect, it } from 'vitest'
import de from '~/i18n/locales/de.json'
import en from '~/i18n/locales/en.json'

// The mechanical part of the wording rules in docs/copy/voice.md: no abbreviations, no emoji, the percent sign per locale.
// The rules themselves (when a word is right) are the copy-writer skill's job; this only catches what a regex can.

type MessageTree = { [key: string]: string | MessageTree }

function flatten(tree: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

const locales = { de: flatten(de as MessageTree), en: flatten(en as MessageTree) }

function offenders(locale: 'de' | 'en', pattern: RegExp): string[] {
  return Object.entries(locales[locale]).filter(([, value]) => pattern.test(value)).map(([key, value]) => `${locale}: ${key} = ${value}`)
}

const ABBREVIATIONS = {
  de: /(^|[^\p{L}])(evtl\.|ggf\.|z\.\s?B\.|bzw\.|usw\.|d\.\s?h\.|inkl\.|ca\.)/u,
  en: /(^|[^\p{L}])(e\.g\.|i\.e\.|etc\.|approx\.)/u,
}

describe('copy mechanics (docs/copy/voice.md)', () => {
  it('has no abbreviation in a locale value', () => {
    expect([...offenders('de', ABBREVIATIONS.de), ...offenders('en', ABBREVIATIONS.en)]).toEqual([])
  })

  it('has no emoji in a locale value', () => {
    expect([...offenders('de', /\p{Extended_Pictographic}/u), ...offenders('en', /\p{Extended_Pictographic}/u)]).toEqual([])
  })

  it('writes the percent sign with a space in German and without one in English', () => {
    expect([...offenders('de', /[\d}]%/), ...offenders('en', /[\d}]\s%/)]).toEqual([])
  })

  it('catches the forms it guards', () => {
    expect(ABBREVIATIONS.de.test('Wert eingeben (z.B. Tag)')).toBe(true)
    expect(ABBREVIATIONS.de.test('ggf. später')).toBe(true)
    expect(ABBREVIATIONS.de.test('Kategorie wählen')).toBe(false)
    expect(ABBREVIATIONS.en.test('Formatted (e.g. 2h)')).toBe(true)
    expect(/\p{Extended_Pictographic}/u.test('Fertig 🎉')).toBe(true)
    expect(/[\d}]%/.test('{share}%')).toBe(true)
    expect(/[\d}]\s%/.test('{share} %')).toBe(true)
  })
})
