/** Switches `__PUBLIC_CLOUD__` (#742) for a test: Vitest defines it as a global (`vitest.config.ts`). Reset it in `afterEach`. */
export function setPublicCloud(on: boolean): void {
  (globalThis as { __PUBLIC_CLOUD__?: boolean }).__PUBLIC_CLOUD__ = on
}
