/**
 * @module nativeContextMenu
 * @description Which right clicks keep the browser's own menu in the production desktop app (#370). A native app has
 * no Back, Reload or Inspect menu, so `plugins/desktop-shell.client.ts` cancels every `contextmenu` event, except
 * where that menu is the copy and paste route: a text field (input, textarea, contenteditable) and a non-empty text
 * selection (Copy). The task card's own menu is not affected (the listener never stops propagation).
 */

/** Text-entry controls: an editable input that takes text (not a checkbox, button, readonly...), a textarea or a contenteditable host. */
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const field = target.closest('input, textarea, [contenteditable]')
  if (!field) return false
  if (field instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(field.type) && !field.readOnly && !field.disabled
  if (field instanceof HTMLTextAreaElement && (field.readOnly || field.disabled)) return false
  if (field instanceof HTMLElement && field.matches('[contenteditable="false"]')) return false
  return true
}

/** True when `target` lies in (or is the element holding) the selected text; an ancestor of the selection does not count. */
function isOnSelection(target: Node, selection: Selection | null): boolean {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || selection.toString().trim() === '') return false
  const range = selection.getRangeAt(0)
  const common = range.commonAncestorContainer
  const root = common instanceof Element ? common : common.parentElement
  return root !== null && root.contains(target) && range.intersectsNode(target)
}

/** True when the browser's context menu must be cancelled for a right click on `target`. */
export function shouldBlockContextMenu(target: EventTarget | null, selection: Selection | null): boolean {
  if (isTextField(target)) return false
  // Copy is offered only where the selection is: a selection elsewhere on the page does not unlock the menu
  if (target instanceof Node && isOnSelection(target, selection)) return false
  return true
}
