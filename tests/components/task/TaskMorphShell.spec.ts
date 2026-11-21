import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import TaskMorphShell from '~/components/task/TaskMorphShell.vue'
import { noteNavigation, resetRouteArrival } from '~/lib/routeArrival'

interface Recorded { target: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions }

let recorded: Recorded[] = []
let reduced = false
let wrapper: VueWrapper | undefined

const rect = (x: number, y: number, w: number, h: number): DOMRect => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) })

const addCard = (id: string, box: DOMRect) => {
  const card = document.createElement('div')
  card.className = 'task'
  card.dataset.taskId = id
  card.textContent = 'Karte'
  card.getBoundingClientRect = () => box
  document.body.append(card)
  return card
}

const mountShell = async (props: { open: boolean; originId?: string | null }) => {
  wrapper = mount(TaskMorphShell, {
    props: { title: 'Aufgabe', ...props },
    slots: { body: () => h('p', { 'data-testid': 'body' }, 'Inhalt') },
    attachTo: document.body,
    global: { stubs: { UButton: { props: ['ariaLabel'], render() { return h('button', { 'aria-label': this.ariaLabel }) } } } },
  })
  await flushPromises()
  return wrapper
}

/** The app bar row, as `app.vue` mounts it: the shell reads its bottom edge (#518). */
const addBar = (bottom: number, top = 0) => {
  const bar = document.createElement('nav')
  bar.setAttribute('data-app-nav', '')
  bar.getBoundingClientRect = () => rect(0, top, 1280, bottom - top)
  document.body.append(bar)
}

const panel = () => document.body.querySelector<HTMLElement>('.task-morph-panel')
const panelAnimation = () => recorded.find((entry) => entry.target === panel() && entry.keyframes.some((frame) => 'left' in frame))

beforeEach(() => {
  // An in-app arrival: the sheet animates. The first route of the session opens at rest (#594, last test)
  resetRouteArrival()
  noteNavigation('/tasks', '/tasks/t1')
  recorded = []
  reduced = false
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { void Promise.resolve().then(() => callback(0)); return 0 })
  vi.stubGlobal('innerWidth', 1280)
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduced-motion'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  // jsdom has no layout: the panel is 384 px high, the content's natural height
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('task-morph-panel') ? rect(Number.parseFloat(this.style.left) || 0, Number.parseFloat(this.style.top) || 0, Number.parseFloat(this.style.width) || 720, 384) : rect(0, 0, 0, 0)
  })
  Element.prototype.animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    recorded.push({ target: this, keyframes, options })
    return { finished: Promise.resolve(), cancel: vi.fn() } as unknown as Animation
  } as typeof Element.prototype.animate
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TaskMorphShell', () => {
  it('stays unmounted while closed', async () => {
    await mountShell({ open: false })
    expect(panel()).toBeNull()
  })

  it('grows from the card to the fixed frame centred on it, in about 340 ms, the card face scaling with it (#705)', async () => {
    addCard('t1', rect(500, 300, 288, 132))
    await mountShell({ open: true, originId: 't1' })
    const grow = panelAnimation()
    expect(grow).toBeDefined()
    expect(grow!.options.duration).toBe(340)
    const [from, to] = grow!.keyframes
    expect(from).toMatchObject({ left: '500px', top: '300px', width: '288px', height: '132px' })
    // The frame is 720 x 612 (85 % of the width) around the card's centre (644, 366), whatever the content's natural height is
    expect(to).toMatchObject({ left: '284px', top: '60px', width: '720px', height: '612px' })
    expect(panel()?.style.left).toBe('284px')
    // The card's face scales by the sheet's width over the card's, from the panel's corner, and dissolves
    const face = recorded.filter((entry) => entry.keyframes.some((frame) => typeof frame.transform === 'string' && String(frame.transform).startsWith('scale(')) && entry.keyframes.length === 2)
    expect(face.map((entry) => entry.keyframes.map((frame) => frame.transform))).toContainEqual(['scale(1)', 'scale(2.5)'])
    expect(face.every((entry) => entry.options.duration === 340)).toBe(true)
  })

  it('keeps the sheet 16 px inside the window for a card at the edge', async () => {
    addCard('t1', rect(980, 650, 288, 132))
    await mountShell({ open: true, originId: 't1' })
    const [, to] = panelAnimation()!.keyframes
    expect(to).toMatchObject({ left: '544px', top: '172px' })
  })

  it('stays below the app bar for a card high in the window (#518)', async () => {
    addBar(56)
    addCard('t1', rect(16, 120, 288, 132))
    await mountShell({ open: true, originId: 't1' })
    const [, to] = panelAnimation()!.keyframes
    // centred on the card it would start at y = -10 -> 16 margin; the bar pushes it to 56
    expect(to).toMatchObject({ left: '16px', top: '56px', width: '720px' })
    expect(panel()?.style.maxHeight).toBe('728px')
  })

  it('opens below the bar when there is no origin card (#518)', async () => {
    addBar(56)
    vi.stubGlobal('innerHeight', 420)
    await mountShell({ open: true, originId: 'missing' })
    const top = Number.parseFloat(panel()!.style.top)
    expect(top).toBeGreaterThanOrEqual(56)
    // and it is on screen: the height is capped to what is left between the bar and the 16 px bottom margin
    expect(panel()?.style.maxHeight).toBe('348px')
  })

  it('ignores a bar fixed at the bottom of a phone-width window (#518)', async () => {
    // the sheet stays open when the window narrows below 768 px; the phone nav then sits at the bottom
    vi.stubGlobal('innerWidth', 700)
    addBar(800, 744)
    addCard('t1', rect(100, 300, 288, 132))
    await mountShell({ open: true, originId: 't1' })
    const [, to] = panelAnimation()!.keyframes
    expect(to).toMatchObject({ left: '16px', top: '82px', width: '668px', height: '568px' })
    expect(panel()?.style.maxHeight).toBe('768px')
  })

  it('gives a narrow window the full width minus 32 px', async () => {
    vi.stubGlobal('innerWidth', 700)
    addCard('t1', rect(100, 300, 288, 132))
    await mountShell({ open: true, originId: 't1' })
    const [, to] = panelAnimation()!.keyframes
    expect(to).toMatchObject({ left: '16px', width: '668px' })
  })

  it('appears centred with a short scale-in when there is no origin card', async () => {
    await mountShell({ open: true, originId: 'missing' })
    expect(panelAnimation()).toBeUndefined()
    const scaleIn = recorded.find((entry) => entry.target === panel() && entry.keyframes.some((frame) => frame.transform === 'scale(0.97)'))
    expect(scaleIn?.options.duration).toBe(160)
    expect(panel()?.style.left).toBe('280px')
    expect(panel()?.style.top).toBe('94px')
  })

  it('treats a card scrolled out of the window as no origin', async () => {
    addCard('t1', rect(500, 1200, 288, 132))
    await mountShell({ open: true, originId: 't1' })
    expect(panelAnimation()).toBeUndefined()
    expect(panel()?.style.top).toBe('94px')
  })

  it('opens at the same place with reduced motion, with a 1 ms fade and no grow', async () => {
    reduced = true
    addCard('t1', rect(500, 300, 288, 132))
    await mountShell({ open: true, originId: 't1' })
    expect(panelAnimation()).toBeUndefined()
    expect(panel()?.style.left).toBe('284px')
    expect(panel()?.style.top).toBe('60px')
    const fades = recorded.filter((entry) => entry.target === panel())
    expect(fades.map((entry) => entry.options.duration)).toEqual([1])
  })

  it('folds back into the card in about 260 ms, the face scaling back down, then reports after-leave', async () => {
    addCard('t1', rect(500, 300, 288, 132))
    const shell = await mountShell({ open: true, originId: 't1' })
    const el = panel()
    recorded = []
    await shell.setProps({ open: false })
    await flushPromises()
    const fold = recorded.find((entry) => entry.target === el && entry.keyframes.some((frame) => 'left' in frame))
    expect(fold?.options.duration).toBe(260)
    expect(fold!.keyframes[1]).toMatchObject({ left: '500px', top: '300px', width: '288px', height: '132px' })
    expect(shell.emitted('after-leave')).toHaveLength(1)
    expect(panel()).toBeNull()
  })

  it('fades out in 140 ms when its card is gone', async () => {
    const card = addCard('t1', rect(500, 300, 288, 132))
    const shell = await mountShell({ open: true, originId: 't1' })
    const el = panel()
    card.remove()
    recorded = []
    await shell.setProps({ open: false })
    await flushPromises()
    const own = recorded.filter((entry) => entry.target === el)
    expect(own.some((entry) => entry.keyframes.some((frame) => 'left' in frame))).toBe(false)
    expect(own.map((entry) => entry.options.duration)).toEqual([140])
    expect(shell.emitted('after-leave')).toHaveLength(1)
  })

  it('does not fold with reduced motion, only a 1 ms fade', async () => {
    reduced = true
    addCard('t1', rect(500, 300, 288, 132))
    const shell = await mountShell({ open: true, originId: 't1' })
    const el = panel()
    recorded = []
    await shell.setProps({ open: false })
    await flushPromises()
    const own = recorded.filter((entry) => entry.target === el)
    expect(own.map((entry) => entry.options.duration)).toEqual([1])
    expect(own[0]!.keyframes.some((frame) => 'left' in frame)).toBe(false)
  })

  it('opens at rest on a direct link, the first route of the session (#594)', async () => {
    resetRouteArrival()
    addCard('t1', rect(500, 300, 288, 132))
    await mountShell({ open: true, originId: 't1' })
    expect(panel()).not.toBeNull()
    expect(recorded).toEqual([])
    expect(panel()?.style.visibility).toBe('visible')
    expect(panel()?.style.width).toBe('720px')
  })

  it('asks the host to close from its own close button, with an accessible name', async () => {
    const shell = await mountShell({ open: true, originId: null })
    const close = document.body.querySelector<HTMLElement>('button[aria-label]')
    expect(close?.getAttribute('aria-label')).toBe('Schließen')
    close!.click()
    expect(shell.emitted('update:open')).toEqual([[false]])
  })

  it('renders the hosted content', async () => {
    await mountShell({ open: true })
    expect(document.body.querySelector('[data-testid="body"]')?.textContent).toBe('Inhalt')
  })
})
