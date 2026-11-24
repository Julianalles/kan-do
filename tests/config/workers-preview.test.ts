// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_NAME, SUBDOMAIN, WORKER, branchKind, previewName, previewUrl } from '../../scripts/workers-preview.mjs'

// ADR 021 "Prototype previews": `proto/*` branches get a gated Worker Preview, other branches no Workers Builds build.
// A preview only reaches Cloudflare on a real push, so its config and its name rules are pinned here.

const root = resolve(__dirname, '../..')
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8')
const wrangler = () => JSON.parse(read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'))

describe('Worker Previews config', () => {
  it('a preview keeps the gate on and the feedback relay in dry-run; Version URLs (production secrets) stay off', () => {
    const config = wrangler()
    expect(config.previews.vars).toEqual({ GATE: 'on', FEEDBACK_RELAY: 'dry-run' })
    expect(config.preview_urls).toBe(false)
    expect(config.vars).not.toHaveProperty('FEEDBACK_RELAY')
  })

  it('the script targets the Worker of wrangler.jsonc and its workers.dev subdomain (ADR 021)', () => {
    expect(wrangler().name).toBe(WORKER)
    expect(read('docs/adr/021-public-web-instance-on-cloudflare-workers.md')).toContain(`https://${WORKER}.${SUBDOMAIN}.workers.dev`)
  })
})

describe('branchKind', () => {
  it.each([
    ['main', 'production'],
    ['proto/812-quick-add', 'preview'],
    ['feat/812-quick-add', 'skip'],
    ['jaylouiz/feat-812-x', 'skip'],
    ['dev', 'skip'],
  ])('%s -> %s', (branch, kind) => {
    expect(branchKind(branch)).toBe(kind)
  })
})

describe('previewName', () => {
  const label = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

  it('turns a proto branch into a DNS-safe name and URL', () => {
    expect(previewName('proto/725-onboarding-concept')).toBe('proto-725-onboarding-concept')
    expect(previewUrl('proto/725-onboarding-concept')).toBe('https://proto-725-onboarding-concept-kando.julius-wuestefeld.workers.dev')
    expect(previewName('Proto/12_Ä--x/')).toBe('proto-12-x')
    expect(previewName('812-x')).toBe('p-812-x')
  })

  it('fits `<name>-kando` into one 63-character DNS label; a cut name keeps a hash of the full branch', () => {
    const a = `proto/900-${'a'.repeat(80)}`
    const b = `proto/900-${'a'.repeat(79)}b`
    expect(previewName(a)).toMatch(label)
    expect(previewName(a).length).toBeLessThanOrEqual(MAX_NAME)
    expect(`${previewName(a)}-${WORKER}`.length).toBeLessThanOrEqual(63)
    expect(previewName(a)).not.toBe(previewName(b))
    expect(previewName(`proto/900-${'a'.repeat(MAX_NAME - 10)}`)).toBe(`proto-900-${'a'.repeat(MAX_NAME - 10)}`)
  })
})
