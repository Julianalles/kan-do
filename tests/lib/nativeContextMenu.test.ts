import { afterEach, describe, expect, it } from 'vitest'
import { shouldBlockContextMenu } from '~/lib/nativeContextMenu'

// #370: no browser context menu in the production desktop app, except where it is the copy and paste route.

function mount<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.append(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

describe('shouldBlockContextMenu', () => {
  it('blocks a label, a button and the page background', () => {
    expect(shouldBlockContextMenu(mount('span'), window.getSelection())).toBe(true)
    expect(shouldBlockContextMenu(mount('button'), window.getSelection())).toBe(true)
    expect(shouldBlockContextMenu(document.body, window.getSelection())).toBe(true)
    expect(shouldBlockContextMenu(null, null)).toBe(true)
  })

  it('keeps the menu on text fields and on text inside a contenteditable', () => {
    expect(shouldBlockContextMenu(mount('input', { type: 'text' }), null)).toBe(false)
    expect(shouldBlockContextMenu(mount('input'), null)).toBe(false)
    expect(shouldBlockContextMenu(mount('textarea'), null)).toBe(false)
    const host = mount('div', { contenteditable: 'true' })
    const inner = document.createElement('span')
    host.append(inner)
    expect(shouldBlockContextMenu(inner, null)).toBe(false)
  })

  it('blocks it on a checkbox, a button input and a contenteditable="false" island', () => {
    expect(shouldBlockContextMenu(mount('input', { type: 'checkbox' }), null)).toBe(true)
    expect(shouldBlockContextMenu(mount('input', { type: 'submit' }), null)).toBe(true)
    expect(shouldBlockContextMenu(mount('div', { contenteditable: 'false' }), null)).toBe(true)
  })

  it('keeps the menu while text is selected (Copy), blocks it again once the selection is empty', () => {
    const p = mount('p')
    p.textContent = 'Error details to copy'
    const range = document.createRange()
    range.selectNodeContents(p)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(shouldBlockContextMenu(p, selection)).toBe(false)

    selection.removeAllRanges()
    expect(shouldBlockContextMenu(p, selection)).toBe(true)
  })

  it('blocks it on a whitespace-only selection', () => {
    const p = mount('p')
    p.textContent = '   '
    const range = document.createRange()
    range.selectNodeContents(p)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(shouldBlockContextMenu(p, selection)).toBe(true)
  })
})
