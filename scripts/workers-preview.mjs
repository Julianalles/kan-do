#!/usr/bin/env node
/**
 * Workers Builds branch handling and Worker Previews of design prototypes (ADR 021 "Prototype previews").
 *
 * Workers Builds runs one build command for every branch, then the deploy command on `main` and the preview command on
 * any other branch. Only `main` and `proto/*` (design-round prototypes) are worth a build: kan-do pushes 200+ PR
 * branches a month, and Workers Free has one concurrent build, so a PR branch would queue the production deploy.
 *
 *   node scripts/workers-preview.mjs build            `npm run build:cloudflare`: builds unless Workers Builds builds a
 *                                                     branch that is neither `main` nor `proto/*` (then a no-op, exit 0)
 *   node scripts/workers-preview.mjs preview          the dashboard's preview command (`npm run preview:cloudflare`):
 *                                                     `wrangler preview` under the name of `previewName`, `proto/*` only
 *   node scripts/workers-preview.mjs url <branch>     the preview URL of a branch (agent-workflow's design rounds)
 *   node scripts/workers-preview.mjs delete <branch>  `wrangler preview delete` (needs `wrangler login` or CLOUDFLARE_API_TOKEN);
 *                                                     a preview that does not exist counts as deleted
 *
 * The preview name is set here, not left to Cloudflare's branch handling: it must be a DNS label together with the Worker
 * name (`<name>-kando` at most 63 characters), and agents must be able to compute the URL without asking Cloudflare.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORKER = 'kando'
export const SUBDOMAIN = 'julius-wuestefeld'
/** A DNS label holds 63 characters; the preview host's first label is `<name>-<worker>`. */
export const MAX_NAME = 63 - WORKER.length - 1

/** What Workers Builds does with a branch: `production` (main), `preview` (proto/*), `skip` (anything else). */
export function branchKind(branch) {
  if (branch === 'main') return 'production'
  if (branch.startsWith('proto/')) return 'preview'
  return 'skip'
}

/**
 * The preview name of a branch: lowercase letters, digits and single dashes, starting with a letter, at most MAX_NAME
 * long. `proto/812-quick-add` becomes `proto-812-quick-add`. A longer name is cut and gets a short hash of the full branch
 * name, so two long branches with the same start still get two previews.
 */
export function previewName(branch) {
  let name = branch.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!/^[a-z]/.test(name)) name = `p-${name}`.replace(/-+$/, '')
  if (name.length <= MAX_NAME) return name
  const hash = createHash('sha1').update(branch).digest('hex').slice(0, 6)
  return `${name.slice(0, MAX_NAME - hash.length - 1).replace(/-+$/, '')}-${hash}`
}

/** Does wrangler's output say the preview does not exist? */
export function isNotFound(output) {
  return /\b10025\b|not found|does not exist/i.test(output)
}

export function previewUrl(branch) {
  return `https://${previewName(branch)}-${WORKER}.${SUBDOMAIN}.workers.dev`
}

function currentBranch() {
  if (process.env.WORKERS_CI_BRANCH) return process.env.WORKERS_CI_BRANCH
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
}

function run(command, args, root) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

function main() {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
  const [command, arg] = process.argv.slice(2)
  const say = message => console.log(`workers-preview: ${message}`)
  switch (command) {
    case 'build': {
      const ciBranch = process.env.WORKERS_CI_BRANCH
      if (ciBranch && branchKind(ciBranch) === 'skip') {
        say(`branch ${ciBranch} is neither main nor proto/*: no build, no preview`)
        return
      }
      return run('npm', ['run', 'build:cloudflare:run'], root)
    }
    case 'preview': {
      const branch = currentBranch()
      const kind = branchKind(branch)
      if (kind === 'production') {
        console.error('workers-preview: main deploys with `wrangler deploy`, never as a preview')
        process.exit(1)
      }
      if (kind === 'skip') {
        say(`branch ${branch} is neither main nor proto/*: no preview`)
        return
      }
      say(`preview ${previewName(branch)} at ${previewUrl(branch)}`)
      return run('npx', ['wrangler', 'preview', '--name', previewName(branch), '-c', 'wrangler.jsonc'], root)
    }
    case 'url':
      if (!arg) break
      console.log(previewUrl(arg))
      return
    case 'delete': {
      if (!arg) break
      const args = ['wrangler', 'preview', 'delete', '--name', previewName(arg), '--skip-confirmation', '-c', 'wrangler.jsonc']
      const result = spawnSync('npx', args, { cwd: root, encoding: 'utf8' })
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
      if (result.status === 0) return say(`deleted the preview ${previewName(arg)}`)
      // Idempotent: the cleanup hook and agent-workflow's sweep may both try; 10025 is Cloudflare's "not found".
      if (isNotFound(output)) return say(`no preview ${previewName(arg)} (already deleted)`)
      process.stderr.write(output)
      process.exit(result.status ?? 1)
    }
  }
  console.error('usage: workers-preview.mjs build | preview | url <branch> | delete <branch>')
  process.exit(64)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
