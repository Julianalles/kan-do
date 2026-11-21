import { describe, expect, it } from 'vitest'
import { customChips, type CustomDisplayEntry } from '~/composables/useTaskDetail'

const entry = (key: string, name: string, value: CustomDisplayEntry['value'], propType: CustomDisplayEntry['propType'] = 'text', isMissing = false): CustomDisplayEntry => ({ key, name, value, propType, isMissing })

describe('customChips (#705)', () => {
  it('a multi-select gives one chip with a badge per tag', () => {
    const chips = customChips([entry('tags', 'Tags', { type: 'multi_select', value: [{ name: 'Steuer' }, { name: 'Haushalt' }] }, 'multi_select')])
    expect(chips).toEqual([{ key: 'tags', name: 'Tags', tags: ['Steuer', 'Haushalt'], text: '' }])
  })

  it('other types read "name value"; the number and the date in the active locale', () => {
    const chips = customChips([
      entry('projekt', 'Projekt', { type: 'select', value: { name: 'Umzug' } }, 'select'),
      entry('aufwand', 'Aufwand', { type: 'number', value: 1234.5 }, 'number'),
      entry('frist', 'Frist', { type: 'date', value: { start: '2026-12-04' } }, 'date'),
      entry('ort', 'Ort', { type: 'text', value: 'Bürgeramt' }),
    ])
    expect(chips.map((c) => [c.name, c.text])).toEqual([
      ['Projekt', 'Umzug'],
      ['Aufwand', '1.234,5'],
      ['Frist', expect.stringContaining('2026')],
      ['Ort', 'Bürgeramt'],
    ])
  })

  it('a checkbox is a chip only while checked, with its name alone', () => {
    expect(customChips([entry('w', 'Wichtig', { type: 'checkbox', value: true }, 'checkbox')])).toEqual([{ key: 'w', name: 'Wichtig', tags: [], text: '' }])
    expect(customChips([entry('w', 'Wichtig', { type: 'checkbox', value: false }, 'checkbox')])).toEqual([])
  })

  it('empty entries give no chip (they keep their row in the popover)', () => {
    expect(customChips([
      entry('tags', 'Tags', { type: 'multi_select', value: [] }, 'multi_select', true),
      entry('projekt', 'Projekt', { type: 'select', value: null }, 'select', true),
      entry('frist', 'Frist', { type: 'date', value: null }, 'date', true),
      entry('aufwand', 'Aufwand', { type: 'number', value: null }, 'number', true),
      entry('ort', 'Ort', { type: 'text', value: '' }, 'text', true),
    ])).toEqual([])
  })

  it('a number of zero is a value', () => {
    expect(customChips([entry('n', 'Anzahl', { type: 'number', value: 0 }, 'number')]).map((c) => c.text)).toEqual(['0'])
  })
})
