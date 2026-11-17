import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// #413: `npm run tauri:dev` runs under its own identifier, so a dev run never touches the installed app's data folder,
// Keychain service or single-instance socket. The identifier is mirrored in Rust (`identifier_migration::DEV_IDENTIFIER`).

const root = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const prod = JSON.parse(read('src-tauri/tauri.conf.json')) as { identifier: string, build: { devUrl: string } }
const dev = JSON.parse(read('src-tauri/tauri.dev.conf.json')) as { identifier: string, build: { devUrl: string } }
const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts

describe('tauri:dev identity (#413)', () => {
  it('uses an identifier of its own, never the production or the legacy one', () => {
    expect(dev.identifier).toBe('io.github.jaylouiz.kan-do.dev')
    expect(dev.identifier).not.toBe(prod.identifier)
    expect(dev.identifier).not.toBe('com.julius.kan-do')
  })

  it('matches the identifier the Rust side treats as a dev identity', () => {
    expect(read('src-tauri/src/identifier_migration.rs')).toContain(`pub const DEV_IDENTIFIER: &str = "${dev.identifier}";`)
  })

  it('opens the demo board on the dev server', () => {
    expect(dev.build.devUrl).toBe(`${prod.build.devUrl}/tasks?seed=demo`)
  })

  it('is what `npm run tauri:dev` loads', () => {
    expect(scripts['tauri:dev']).toContain('--config src-tauri/tauri.dev.conf.json')
  })
})
