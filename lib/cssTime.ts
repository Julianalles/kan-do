/**
 * A CSS `<time>` read back from `getPropertyValue` as milliseconds. The production build minifies `1400ms` to `1.4s` and `700ms` to
 * `.7s`, the dev server keeps the source text, so a bare `parseFloat` is 1400 in dev and 1.4 in production (#490). 0 when unreadable.
 */
export function cssTimeMs(value: string): number {
  const match = /^\s*(-?(?:\d+\.?\d*|\.\d+))(ms|s)?\s*$/.exec(value)
  if (!match) return 0
  const n = Number.parseFloat(match[1]!)
  return match[2] === 's' ? n * 1000 : n
}
