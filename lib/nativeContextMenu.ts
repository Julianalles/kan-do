/**
 * @module nativeContextMenu
 * @description Which right clicks keep the browser's own menu in the production desktop app (#370). A native app has
 * no Back, Reload or Inspect menu, so `plugins/desktop-shell.client.ts` cancels every `contextmenu` event, except
 * where that menu is the copy and paste route: a text field (input, textarea, contenteditable) and a non-empty text
 * selection (Copy). The task card's own menu is not affected (the listener never stops propagation).
 */

/** Text-entry controls: an input that takes text (not a checkbox, button, ...), a textarea or a contenteditable host. */
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const field = target.closest('input, textarea, [contenteditable]')
  if (!field) return false
  if (field instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(field.type)
  if (field instanceof HTMLElement && field.matches('[contenteditable="false"]')) return false
  return true
}

/** True when the browser's context menu must be cancelled for a right click on `target`. */
export function shouldBlockContextMenu(target: EventTarget | null, selection: Selection | null): boolean {
  if (isTextField(target)) return false
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return false
  return true
}
