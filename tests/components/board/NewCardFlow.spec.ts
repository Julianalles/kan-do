import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { toastAddMock } from '~/tests/mocks/nuxt-imports'
import NewCardFlow from '~/components/board/NewCardFlow.vue'

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn(), useRoute: () => ({ query: {}, name: 'tasks' }) }))

const tasks = vi.hoisted(() => ({ list: [] as Array<{ topic: string | null; activity: string | null }> }))
vi.mock('~/store/tasks', () => ({ useTasksStore: () => ({ get tasks() { return tasks.list } }) }))
const options = vi.hoisted(() => ({ topics: [] as string[], activities: [] as string[] }))
vi.mock('~/store/propertyOptions', () => ({
  usePropertyOptionsStore: () => ({
    get getTopicOptions() { return options.topics },
    get getActivityOptions() { return options.activities },
  }),
}))
vi.mock('~/store/notionConfig', () => ({ useNotionConfigStore: () => ({ config: null }) }))

const target = vi.hoisted(() => ({ source: 'local' as string }))
vi.mock('~/composables/useAddTarget', () => ({ useAddTarget: () => ({ defaultSource: { get value() { return target.source } } }) }))
const sync = vi.hoisted(() => ({ createTask: vi.fn() }))
vi.mock('~/composables/useTaskSync', () => ({ useTaskSync: () => ({ createTask: sync.createTask }) }))
const errors = vi.hoisted(() => ({ handleError: vi.fn() }))
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => errors }))
vi.mock('~/composables/useTimeboxSuggestion', () => ({ useTimeboxSuggestion: () => ({ calculateSuggestion: () => null }) }))
vi.mock('~/composables/usePropertyOptionsSync', () => ({ usePropertyOptionsSync: () => ({ ensureOptionsAvailable: vi.fn() }) }))
const topicColor = vi.hoisted(() => ({ colors: {} as Record<string, string> }))
vi.mock('~/composables/useTopicColor', () => ({
  useTopicColor: () => ({ colorCodeFor: (topic: string | null, source: string) => (source === 'todoist' ? null : topicColor.colors[topic ?? ''] ?? null) }),
}))
vi.mock('~/composables/useIsDesktop', () => ({ useIsDesktop: () => ref(true), isPhoneNow: () => false }))

const stubs = {
  TaskCard: { props: ['task'], template: '<div class="task-face" :data-title="task.title" :data-topic="task.topic" :data-color="task.topicColorCode"><p class="task-title-text" /></div>' },
  TopicMark: true,
  UIcon: true,
  // The real UButton is a Nuxt UI component the unit environment does not register: a native button with the same disabled behaviour.
  UButton: { props: ['disabled', 'color', 'variant', 'size'], template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>' },
  UPopover: { template: '<div><slot /><slot name="content" /></div>' },
  UInput: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    setup(_: unknown, { expose }: { expose: (e: Record<string, unknown>) => void }) {
      const inputRef = ref<HTMLInputElement | null>(null)
      expose({ inputRef })
      return { inputRef }
    },
    template: '<input ref="inputRef" :value="modelValue" v-bind="$attrs" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  UDrawer: true,
  // The combobox of Thema and Aktivität (#434): an input (its text is the search term), the step's values as buttons, a "create" button while a new value is offered
  UInputMenu: {
    name: 'UInputMenu',
    inheritAttrs: false,
    props: ['modelValue', 'searchTerm', 'items', 'createItem', 'placeholder'],
    emits: ['update:modelValue', 'update:searchTerm', 'create', 'highlight'],
    setup(_: unknown, { expose }: { expose: (e: Record<string, unknown>) => void }) {
      const inputRef = ref<HTMLInputElement | null>(null)
      expose({ inputRef })
      return { inputRef }
    },
    template: `<div class="combo">
      <input ref="inputRef" :value="searchTerm || modelValue || ''" :placeholder="placeholder" v-bind="$attrs" @input="$emit('update:searchTerm', $event.target.value)" />
      <button v-for="item in items" :key="item" type="button" class="combo-item" @click="$emit('update:modelValue', item)">{{ item }}</button>
      <button v-if="createItem" type="button" class="combo-create" @click="$emit('create', searchTerm)">create</button>
    </div>`,
  },
  Transition: { template: '<slot />' },
}

let w: VueWrapper
const mountFlow = () => {
  w = mount(NewCardFlow, { global: { stubs }, attachTo: document.body })
  return w
}
const title = () => w.get('[data-testid="new-card-title"]')
const stepKey = () => w.find('[data-testid="new-card-step"]').attributes('data-step')
const pressOnPanel = (key: string) => w.get('[data-testid="new-card-step"]').trigger('keydown', { key })

async function confirmTitle(text = 'Angebot schreiben') {
  await title().setValue(text)
  await w.get('form').trigger('submit')
  await nextTick()
}
/** A pick advances after a short beat (200 ms, 0 under reduced motion) */
async function afterPick() {
  await vi.advanceTimersByTimeAsync(250)
  await nextTick()
}

const combo = () => w.get('[data-testid="new-card-combo"]')
const comboItems = () => w.findAll('.combo-item').map((item) => item.text())
/** A pick in the combobox of Thema or Aktivität, as a click on its entry */
async function pickCombo(value: string) {
  await w.findAll('.combo-item').find((item) => item.text() === value)!.trigger('click')
}
/** The list's own highlight (it highlights the first entry by itself when it opens) */
const highlight = (value: string | null) => w.findComponent({ name: 'UInputMenu' }).vm.$emit('highlight', value === null ? undefined : { value })

beforeEach(() => {
  vi.useFakeTimers()
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  tasks.list = [
    { topic: 'Design', activity: 'Planung' },
    { topic: 'Design', activity: 'Planung' },
    { topic: 'Backend', activity: 'Entwicklung' },
    { topic: 'Büro', activity: 'Abstimmung' },
  ]
  options.topics = ['Büro', 'Backend', 'Design']
  options.activities = ['Abstimmung', 'Entwicklung', 'Planung']
  target.source = 'local'
  topicColor.colors = { Design: '#6366f1' }
  sync.createTask.mockReset()
  sync.createTask.mockImplementation(async (draft: Record<string, unknown>) => ({ ...draft, id: 'local_1' }))
  errors.handleError.mockReset()
  toastAddMock.mockReset()
})
afterEach(() => {
  w?.unmount()
  vi.useRealTimers()
})

describe('NewCardFlow (#649)', () => {
  it('starts on the title with the check disabled while it is blank', async () => {
    mountFlow()
    expect(w.get('[data-testid="new-card-confirm-title"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="new-card-step"]').exists()).toBe(false)
    await title().setValue('  ')
    expect(w.get('[data-testid="new-card-confirm-title"]').attributes('disabled')).toBeDefined()
    await title().setValue('Etwas')
    expect(w.get('[data-testid="new-card-confirm-title"]').attributes('disabled')).toBeUndefined()
  })

  it('walks Thema, Aktivität, Timebox and Notiz with the keys and saves the picked values', async () => {
    mountFlow()
    await confirmTitle()
    expect(stepKey()).toBe('topic')
    // Design is the most used topic: it leads the list
    expect(comboItems()[0]).toBe('Design')
    await pickCombo('Design')
    await afterPick()
    expect(stepKey()).toBe('activity')
    // Planung leads under Design
    expect(comboItems()[0]).toBe('Planung')
    await pickCombo('Entwicklung')
    await afterPick()
    expect(stepKey()).toBe('timebox')
    await pressOnPanel('2') // 30 min
    await afterPick()
    expect(stepKey()).toBe('notes')
    await w.get('[data-testid="new-card-notes"]').setValue('Mit Preisliste')
    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()

    expect(sync.createTask).toHaveBeenCalledTimes(1)
    const [draft, source] = sync.createTask.mock.calls[0]!
    expect(source).toBe('local')
    expect(draft).toMatchObject({ title: 'Angebot schreiben', status: 0, topic: 'Design', topicColorCode: '#6366f1', timeBoxSeconds: 1800, notes: 'Mit Preisliste', priority: 2 })
    expect(draft.activity).toBe('Entwicklung')
    expect(w.emitted('saved')![0]).toEqual(['local_1'])
    expect(toastAddMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Aufgabe hinzugefügt' }))
    // One row (title and Details): no description line that wraps over the saved card at 390 px (#665)
    expect(toastAddMock.mock.calls[0]![0]).not.toHaveProperty('description')
  })

  it('skip keeps a field empty; an empty note saves without one', async () => {
    mountFlow()
    await confirmTitle()
    await pressOnPanel('Enter') // skip Thema
    await pressOnPanel('Enter') // skip Aktivität
    await pressOnPanel('Enter') // skip Timebox
    expect(stepKey()).toBe('notes')
    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()
    expect(sync.createTask.mock.calls[0]![0]).toMatchObject({ topic: null, activity: null, timeBoxSeconds: null, notes: null })
  })

  it('a held key does not skip through the steps', async () => {
    mountFlow()
    await confirmTitle()
    await w.get('[data-testid="new-card-step"]').trigger('keydown', { key: 'Enter', repeat: true })
    await w.get('[data-testid="new-card-step"]').trigger('keydown', { key: '1', repeat: true })
    expect(stepKey()).toBe('topic')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('activity')
  })

  it('a held Esc does not walk back through the steps or cancel the card', async () => {
    mountFlow()
    await confirmTitle('Bleibt')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('activity')
    const panel = () => w.get('[data-testid="new-card-step"]')
    await panel().trigger('keydown', { key: 'Escape', repeat: true })
    await panel().trigger('keydown', { key: 'Escape', repeat: true })
    expect(stepKey()).toBe('activity')
    await pressOnPanel('Escape')
    expect(stepKey()).toBe('topic')
    await pressOnPanel('Escape')
    await title().trigger('keydown', { key: 'Escape', repeat: true })
    expect(w.emitted('cancel')).toBeUndefined()
    expect((title().element as HTMLInputElement).value).toBe('Bleibt')
  })

  it('Enter right after a pick moves on one step only and never saves from Timebox', async () => {
    mountFlow()
    await confirmTitle()
    await pressOnPanel('Enter') // Thema
    await pressOnPanel('Enter') // Aktivität
    expect(stepKey()).toBe('timebox')
    await pressOnPanel('2') // pick: the advance timer is pending
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('notes')
    await afterPick() // the pending timer must not advance again from Notiz
    expect(stepKey()).toBe('notes')
    expect(sync.createTask).not.toHaveBeenCalled()
  })

  it('Esc right after a pick goes back and the pending advance does not undo it', async () => {
    mountFlow()
    await confirmTitle()
    await pressOnPanel('Enter') // Thema skipped
    expect(stepKey()).toBe('activity')
    await pressOnPanel('1') // pick: the advance timer is pending
    await pressOnPanel('Escape')
    expect(stepKey()).toBe('topic')
    await afterPick()
    expect(stepKey()).toBe('topic')
  })

  it('Esc steps back one step keeping the input; on the title step it cancels', async () => {
    mountFlow()
    await confirmTitle('Bleibt')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('activity')
    await pressOnPanel('Escape')
    expect(stepKey()).toBe('topic')
    await pressOnPanel('Escape')
    expect(w.find('[data-testid="new-card-step"]').exists()).toBe(false)
    expect((title().element as HTMLInputElement).value).toBe('Bleibt')
    await title().trigger('keydown', { key: 'Escape' })
    expect(w.emitted('cancel')).toHaveLength(1)
  })

  it('#668: the title field follows the face title down under the topic row after Thema and back', async () => {
    mountFlow()
    // jsdom has no layout: the face's title stands 30 px down once a topic row exists, like a card
    const layout = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('task-title-text') ? (w.get('.task-face').attributes('data-topic') ? 30 : 8) : 0
    })
    const parent = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('task-title-text') ? w.get('[data-testid="new-card-flow"]').element : null
    })
    await confirmTitle()
    await pickCombo('Design') // Thema Design
    await afterPick()
    await pressOnPanel('Escape') // Aktivität → Thema
    await pressOnPanel('Escape') // Thema → title
    const form = w.get('.ncf__title-form').element as HTMLElement
    expect(form.style.getPropertyValue('--ncf-title-top')).toBe('30px')
    layout.mockRestore()
    parent.mockRestore()
  })

  it('#665: line breaks never enter the title, Enter confirms and Shift+Enter does not break the line', async () => {
    mountFlow()
    await title().setValue('Erste\nZweite  \r\n  Dritte')
    expect((title().element as HTMLTextAreaElement).value).toBe('Erste Zweite Dritte')
    await title().trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(w.find('[data-testid="new-card-step"]').exists()).toBe(false)
    await title().trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(stepKey()).toBe('topic')
  })

  it('#665: the title field grows with its text', async () => {
    mountFlow()
    const el = title().element as HTMLTextAreaElement
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 64 })
    await title().setValue('Ein sehr langer Titel, der in der Karte umbricht und gelesen werden soll')
    expect(el.style.height).toBe('64px')
  })

  it('#668: the Enter that commits an IME composition does not confirm the title (WebKit: isComposing false, keyCode 229)', async () => {
    mountFlow()
    await title().setValue('にほん')
    await title().trigger('keydown', { key: 'Enter', isComposing: true })
    await title().trigger('keydown', { key: 'Enter', keyCode: 229 })
    await nextTick()
    expect(w.find('[data-testid="new-card-step"]').exists()).toBe(false)
    await title().trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(stepKey()).toBe('topic')
  })

  it('#668: the field is never taller than the face title, which is what the card shows of a long title', async () => {
    mountFlow()
    const el = title().element as HTMLTextAreaElement
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 117 })
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains('task-title-text') ? 58.5 : 0 } as DOMRect
    })
    await title().setValue('Ein sehr langer Titel, den die Karte nach drei Zeilen abschneidet, weil unter dem Thema nicht mehr Platz ist')
    expect(el.style.maxHeight).toBe('58.5px')
    rect.mockRestore()
  })

  it('#665: Esc on a typed title hands it to the slot, a blank one cancels without a draft', async () => {
    mountFlow()
    await title().trigger('keydown', { key: 'Escape' })
    expect(w.emitted('cancel')![0]).toEqual([undefined])
    await title().setValue('  Tippfehler  ')
    await title().trigger('keydown', { key: 'Escape' })
    expect(w.emitted('cancel')![1]).toEqual([{ title: 'Tippfehler' }])
  })

  it('#665: the card opens with an initial title, caret at the end', async () => {
    w = mount(NewCardFlow, { props: { initialTitle: 'Zurück' }, global: { stubs }, attachTo: document.body })
    await nextTick()
    expect((title().element as HTMLTextAreaElement).value).toBe('Zurück')
    expect(w.get('.task-face').attributes('data-title')).toBe('Zurück')
  })

  it('#665: Cmd/Ctrl+Enter saves what is entered from the title step and from a choice step', async () => {
    mountFlow()
    await title().trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(sync.createTask).not.toHaveBeenCalled() // a blank title saves nothing
    await title().setValue('Sofort')
    await title().trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(sync.createTask).toHaveBeenCalledTimes(1)
    expect(sync.createTask.mock.calls[0]![0]).toMatchObject({ title: 'Sofort', topic: null, notes: null })
    expect(w.emitted('saved')![0]).toEqual(['local_1'])
    w.unmount()

    sync.createTask.mockClear()
    mountFlow()
    await confirmTitle('Mit Thema')
    await pickCombo('Design') // pick: its advance is pending
    await w.get('[data-testid="new-card-step"]').trigger('keydown', { key: 'Enter', metaKey: true })
    await flushPromises()
    await afterPick() // the pending advance must not fire a second save
    expect(sync.createTask).toHaveBeenCalledTimes(1)
    expect(sync.createTask.mock.calls[0]![0]).toMatchObject({ title: 'Mit Thema', topic: 'Design' })
  })

  it('#665: a held Cmd/Ctrl+Enter saves once and a failed save keeps the card where it was', async () => {
    sync.createTask.mockRejectedValueOnce(new Error('offline'))
    mountFlow()
    await title().setValue('Bleibt')
    await title().trigger('keydown', { key: 'Enter', ctrlKey: true })
    await title().trigger('keydown', { key: 'Enter', ctrlKey: true, repeat: true })
    await flushPromises()
    expect(sync.createTask).toHaveBeenCalledTimes(1)
    expect(w.emitted('saved')).toBeUndefined()
    expect((title().element as HTMLTextAreaElement).value).toBe('Bleibt')
    await title().trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(sync.createTask).toHaveBeenCalledTimes(2)
    expect(w.emitted('saved')).toHaveLength(1)
  })

  it('shows the topic on the face behind the wash once it is picked', async () => {
    mountFlow()
    await confirmTitle()
    expect(w.get('.task-face').attributes('data-topic')).toBeUndefined()
    await pickCombo('Design')
    expect(w.get('.task-face').attributes('data-topic')).toBe('Design')
    expect(w.get('.task-face').attributes('data-title')).toBe('Angebot schreiben')
    // the colour its siblings with the topic show, already on the face (#672)
    expect(w.get('.task-face').attributes('data-color')).toBe('#6366f1')
  })

  it('#672: a topic without a colour saves without one', async () => {
    topicColor.colors = {}
    mountFlow()
    await confirmTitle()
    await pickCombo('Design')
    expect(w.get('.task-face').attributes('data-color')).toBeUndefined()
    await afterPick()
    await pressOnPanel('Enter')
    await pressOnPanel('Enter')
    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()
    expect(sync.createTask.mock.calls[0]![0]).toMatchObject({ topic: 'Design', topicColorCode: null })
  })

  it('#434: Thema and Aktivität are a combobox on the whole ranked list, no pills and no number keys; Timebox keeps three pills and the dots icon (key 4, kd#119)', async () => {
    mountFlow()
    await confirmTitle()
    const pills = () => w.get('[data-testid="new-card-options"]').findAll('button.ncf__pill:not(.ncf__pill--more)')
    expect(pills()).toHaveLength(0)
    expect(w.find('[data-testid="new-card-more"]').exists()).toBe(false)
    expect(comboItems()).toEqual(['Design', 'Backend', 'Büro'])
    expect(combo().attributes('placeholder')).toBe('Thema wählen')
    // digits are text in the field: they pick nothing on the step
    await pressOnPanel('1')
    await pressOnPanel('4')
    expect(w.get('.task-face').attributes('data-topic')).toBeUndefined()
    expect(stepKey()).toBe('topic')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('activity')
    expect(combo().attributes('placeholder')).toBe('Aktivität wählen')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('timebox')
    expect(pills().map((pill) => pill.text())).toEqual(['15 min', '30 min', '60 min'].map((v) => expect.stringContaining(v)))
    expect(w.get('[data-testid="new-card-more"]').attributes('aria-keyshortcuts')).toBe('4')
    expect(w.get('[data-testid="new-card-more"]').classes()).not.toContain('choice-chip--field')
  })

  it('#434: Enter on an empty field continues without a value, also while the list shows its own first highlight; an entry walked to with the arrows is taken', async () => {
    mountFlow()
    await confirmTitle()
    await highlight('Design') // the list highlights its first entry the moment it opens: no choice yet
    await combo().trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(stepKey()).toBe('activity')
    expect(w.get('.task-face').attributes('data-topic')).toBeUndefined()
    await pressOnPanel('Escape')
    expect(stepKey()).toBe('topic')
    // walked with ↓: the entry is the list's to take (it emits the pick itself), Enter must not also skip
    await combo().trigger('keydown', { key: 'ArrowDown' })
    await highlight('Backend')
    await combo().trigger('keydown', { key: 'Enter' })
    expect(stepKey()).toBe('topic')
  })

  it('#434: a value shows when coming back; deleting the text or the clear button takes it away, Enter then continues without it', async () => {
    mountFlow()
    await confirmTitle()
    await pickCombo('Design')
    await afterPick()
    await pressOnPanel('Escape')
    expect(stepKey()).toBe('topic')
    expect(w.findComponent({ name: 'UInputMenu' }).props('modelValue')).toBe('Design')
    expect(w.get('.task-face').attributes('data-topic')).toBe('Design')
    await combo().setValue('')
    expect(w.get('.task-face').attributes('data-topic')).toBeUndefined()
    await combo().trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(stepKey()).toBe('activity')
    await pressOnPanel('Enter')
    await pressOnPanel('Enter')
    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()
    expect(sync.createTask.mock.calls[0]![0]).toMatchObject({ topic: null })

    // the list's clear button resets its model: the step's value goes
    w.unmount()
    mountFlow()
    await confirmTitle()
    await pickCombo('Design')
    await afterPick()
    await pressOnPanel('Escape')
    w.findComponent({ name: 'UInputMenu' }).vm.$emit('update:modelValue', null)
    await nextTick()
    expect(w.get('.task-face').attributes('data-topic')).toBeUndefined()
  })

  it('#434 review: the list toggling the checked row off (undefined) keeps the value and moves on; only null clears', async () => {
    mountFlow()
    await confirmTitle()
    await pickCombo('Design')
    await afterPick()
    await pressOnPanel('Escape')
    w.findComponent({ name: 'UInputMenu' }).vm.$emit('update:modelValue', undefined)
    await afterPick()
    expect(w.get('.task-face').attributes('data-topic')).toBe('Design')
    expect(stepKey()).toBe('activity')
  })

  it('#434 review: a stale highlight (its row no longer listed) does not make Enter dead: the exact match is taken', async () => {
    mountFlow()
    await confirmTitle()
    await highlight('Backend') // the pointer left the list, or the filter emptied it: the list reports nothing more
    await combo().setValue('design ')
    await combo().trigger('keydown', { key: 'Enter' })
    await afterPick()
    expect(w.get('.task-face').attributes('data-topic')).toBe('Design')
  })

  it('#434: Esc and Backspace/Delete in the field: Esc goes back, Backspace and Delete only edit text', async () => {
    mountFlow()
    await confirmTitle('Bleibt')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('activity')
    await combo().trigger('keydown', { key: 'Backspace' })
    await combo().trigger('keydown', { key: 'Delete' })
    expect(stepKey()).toBe('activity')
    await combo().trigger('keydown', { key: 'Escape' })
    expect(stepKey()).toBe('topic')
  })

  it('#434: a source without free values offers no new value; the field only filters', async () => {
    target.source = 'todoist'
    mountFlow()
    await confirmTitle()
    expect(stepKey()).toBe('topic')
    await combo().setValue('Neu')
    expect(w.find('.combo-create').exists()).toBe(false)
    w.unmount()

    target.source = 'local'
    mountFlow()
    await confirmTitle()
    await combo().setValue('Neu')
    expect(w.find('.combo-create').exists()).toBe(true)
    // an existing name (any case) is no new value
    await combo().setValue('design')
    expect(w.find('.combo-create').exists()).toBe(false)
  })

  it('#434: a new topic typed into the field is picked and saved as typed (Enter, or the "Neu" row)', async () => {
    mountFlow()
    await confirmTitle()
    await combo().setValue('  Frisch  ')
    expect(w.find('.combo-create').exists()).toBe(true)
    await combo().trigger('keydown', { key: 'Enter' })
    await afterPick()
    expect(stepKey()).toBe('activity')
    expect(w.get('.task-face').attributes('data-topic')).toBe('Frisch')
    await pressOnPanel('Enter')
    await pressOnPanel('Enter')
    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()
    expect(sync.createTask.mock.calls[0]![0]).toMatchObject({ topic: 'Frisch' })

    w.unmount()
    mountFlow()
    await confirmTitle()
    await combo().setValue('Garten')
    await w.get('.combo-create').trigger('click')
    expect(w.get('.task-face').attributes('data-topic')).toBe('Garten')
  })

  it('#434: Enter on typed text takes the exact match (its own spelling), else the first match, and never creates a partial match', async () => {
    mountFlow()
    await confirmTitle()
    await combo().setValue('design')
    expect(w.find('.combo-create').exists()).toBe(false)
    await combo().trigger('keydown', { key: 'Enter' })
    expect(w.get('.task-face').attributes('data-topic')).toBe('Design')
    w.unmount()

    mountFlow()
    await confirmTitle()
    await combo().setValue('bac') // a partial match: Backend, not a new topic "bac"
    await combo().trigger('keydown', { key: 'Enter' })
    expect(w.get('.task-face').attributes('data-topic')).toBe('Backend')
  })

  it('#434: the combobox list is capped to the room above the on-screen keyboard (the visual viewport), never below two rows', async () => {
    const listeners: Record<string, () => void> = {}
    const viewport = { height: 400, offsetTop: 0, addEventListener: (type: string, fn: () => void) => { listeners[type] = fn }, removeEventListener: vi.fn() }
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ bottom: 200 } as DOMRect)
    const room = () => document.documentElement.style.getPropertyValue('--combo-list-room')
    mountFlow()
    await confirmTitle()
    expect(room()).toBe('min(15rem, 184px)') // 400 - 200 - 16
    // the keyboard comes up: the visual viewport shrinks and tells so
    viewport.height = 300
    listeners.resize!()
    expect(room()).toBe('min(15rem, 96px)') // 300 - 200 - 16 = 84 is under two rows: the floor
    viewport.height = 500
    listeners.resize!()
    expect(room()).toBe('min(15rem, 284px)')
    w.unmount()
    expect(room()).toBe('') // the property goes with the card
    rect.mockRestore()
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
  })

  it('#434: the Enter that commits an IME composition in the field is no Enter', async () => {
    mountFlow()
    await confirmTitle()
    await combo().setValue('にほん')
    await combo().trigger('keydown', { key: 'Enter', isComposing: true })
    await combo().trigger('keydown', { key: 'Enter', keyCode: 229 })
    await nextTick()
    expect(stepKey()).toBe('topic')
    expect(w.get('.task-face').attributes('data-topic')).toBeUndefined()
  })

  it('skips Thema and Aktivität on a board without values and when the source lacks the field', async () => {
    options.topics = []
    options.activities = []
    tasks.list = []
    mountFlow()
    await confirmTitle()
    expect(stepKey()).toBe('timebox')
    w.unmount()

    // Todoist: priority and topic only, no timebox or activity
    options.topics = ['Design']
    options.activities = ['Planung']
    target.source = 'todoist'
    mountFlow()
    await confirmTitle()
    expect(stepKey()).toBe('topic')
    await pressOnPanel('Enter')
    expect(stepKey()).toBe('notes')
  })

  it('a failed save keeps the card on Notiz with everything entered and saves again', async () => {
    sync.createTask.mockRejectedValueOnce(new Error('offline'))
    mountFlow()
    await confirmTitle()
    await pickCombo('Design')
    await afterPick()
    await pickCombo('Planung')
    await afterPick()
    await pressOnPanel('1')
    await afterPick()
    await w.get('[data-testid="new-card-notes"]').setValue('Bleibt')
    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()

    expect(errors.handleError).toHaveBeenCalledWith(expect.any(Error), 'task_create')
    expect(w.emitted('saved')).toBeUndefined()
    expect(stepKey()).toBe('notes')
    expect((w.get('[data-testid="new-card-notes"]').element as HTMLInputElement).value).toBe('Bleibt')
    expect(w.get('[data-testid="new-card-save"]').attributes('disabled')).toBeUndefined()

    await w.get('form.ncf__row').trigger('submit')
    await flushPromises()
    expect(sync.createTask).toHaveBeenCalledTimes(2)
    expect(sync.createTask.mock.calls[1]![0]).toEqual(sync.createTask.mock.calls[0]![0])
    expect(w.emitted('saved')).toHaveLength(1)
  })

  it('a press outside cancels a blank card only', async () => {
    mountFlow()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(w.emitted('cancel')).toHaveLength(1)
    w.unmount()

    mountFlow()
    await title().setValue('Text')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(w.emitted('cancel')).toBeUndefined()
  })

  it('does not save twice while a save runs', async () => {
    let resolve!: (task: { id: string }) => void
    sync.createTask.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    mountFlow()
    await confirmTitle()
    await pressOnPanel('Enter')
    await pressOnPanel('Enter')
    await pressOnPanel('Enter')
    await w.get('form.ncf__row').trigger('submit')
    await w.get('form.ncf__row').trigger('submit')
    expect(sync.createTask).toHaveBeenCalledTimes(1)
    resolve({ id: 'local_9' })
    await flushPromises()
    expect(w.emitted('saved')).toHaveLength(1)
  })
})
