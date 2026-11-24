/**
 * #804: turning the intro hints off. One path for the link on a hint and the settings button: the record's `on` goes
 * false (the answered hints stay) and a toast confirms it; "Erneut zeigen" starts again from the first without a toast.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const toastAdd = vi.hoisted(() => vi.fn())
vi.mock('#imports', () => ({ useToast: () => ({ add: toastAdd }) }))

/* eslint-disable import/first -- order-sensitive: the mock must be registered before the SUT is imported */
import { useIntroHintsSwitch } from '~/composables/useIntroHintsSwitch'
import { useSettingsStore } from '~/store/settings'
/* eslint-enable import/first */

beforeEach(() => {
  setActivePinia(createPinia())
  toastAdd.mockClear()
})

describe('useIntroHintsSwitch', () => {
  it('turns the hints off and confirms it once, with where to read them', () => {
    const settings = useSettingsStore()
    settings.startIntroHints()
    settings.answerIntroHint('start')
    const { running, turnOff } = useIntroHintsSwitch()
    expect(running.value).toBe(true)
    turnOff()
    expect(running.value).toBe(false)
    expect(settings.introHints).toEqual({ on: false, quietDay: null, hints: { start: { answered: true, days: [] } } })
    expect(toastAdd).toHaveBeenCalledTimes(1)
    const toast = toastAdd.mock.calls[0]![0] as { title: string, description: string }
    expect(toast.title).toBe('Hinweise ausgeschaltet')
    expect(toast.description).toContain('Einstellungen, Board')
  })

  it('says nothing and writes nothing when the hints are already off or never started', () => {
    const { turnOff } = useIntroHintsSwitch()
    turnOff()
    expect(useSettingsStore().introHints).toBeNull()
    useSettingsStore().startIntroHints()
    turnOff()
    toastAdd.mockClear()
    turnOff()
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it('"Erneut zeigen" starts again from the first, from off and from an install without hints, with no toast', () => {
    const settings = useSettingsStore()
    const { running, restart } = useIntroHintsSwitch()
    restart()
    expect(settings.introHints).toEqual({ on: true, quietDay: null, hints: {} })
    expect(running.value).toBe(true)
    settings.answerIntroHint('start')
    settings.setIntroHintsOn(false)
    expect(running.value).toBe(false)
    restart()
    expect(settings.introHints).toEqual({ on: true, quietDay: null, hints: {} })
    expect(toastAdd).not.toHaveBeenCalled()
  })
})
