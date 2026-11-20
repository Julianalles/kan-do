import { describe, it, expect } from 'vitest'
import { sourceCompound } from '~/utils/sourceCompound'

describe('sourceCompound (#685)', () => {
  it('couples a two-word name with hyphens in German', () => {
    expect(sourceCompound('Apple Erinnerungen', 'de')).toBe('Apple-Erinnerungen')
    expect(sourceCompound('Apple Erinnerungen', 'de-DE')).toBe('Apple-Erinnerungen')
  })
  it('keeps a one-word name and other locales as they are', () => {
    expect(sourceCompound('Notion', 'de')).toBe('Notion')
    expect(sourceCompound('Apple Reminders', 'en')).toBe('Apple Reminders')
  })
})
