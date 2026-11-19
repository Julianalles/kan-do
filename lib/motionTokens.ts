/**
 * The motion tokens of `assets/css/main.css` for scripted animations (`element.animate()`, dnd-kit), which take numbers
 * and curve strings, not custom properties (#593). The values are the CSS ones; `tests/config/motion-tokens.test.ts`
 * fails when the two drift. A scripted animation reads them from here, so the motion ratchet
 * (`scripts/lint/design-tokens.mjs`) has no literal to count.
 */
export const MOTION = {
  /** `--duration-fast` */
  fastMs: 150,
  /** `--duration-base` */
  baseMs: 200,
  /** `--duration-slow` */
  slowMs: 300,
  /** `--duration-place` */
  placeMs: 400,
  /** `--duration-curtain` */
  curtainMs: 700,
  /** `--duration-stage` */
  stageMs: 1300,
  /** `--ease-standard`: things that change in place */
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** `--ease-emphasized`: things that arrive and settle */
  emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
} as const
