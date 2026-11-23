/**
 * @module feedback/buildIssueBody
 * @description Renders the GitHub issue body of an in-app report (#227). English headings, the
 * user's text verbatim. Items the user removed are absent, never blank. The send path posts this string
 * unchanged; the review step shows the same content as plain lines (`previewLines`, #760).
 */
import { FEEDBACK_ASSETS_BRANCH, FEEDBACK_RELAY_REPO, FEEDBACK_REPO, type IssueBodyInput } from '~/lib/feedback/types'
import { relayScreenshotBranch } from '~/lib/feedback/retention'

/** A table cell must stay on one line and must not close the cell early. */
function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
}

function code(value: string): string {
  const safe = value.replace(/\r?\n/g, ' ')
  const longest = Math.max(0, ...(safe.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${safe}${fence}`
}

/** The shortest backtick fence that no line of `text` can close. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/** One context fact: a stable key (the review step's German label), the raw value, and whether the issue body sets it as code. */
export interface ContextFact { key: string, value: string, code: boolean, label: string }

/** The context facts in body order; `contextRows` renders them for the issue body, `previewLines` for the review step. */
export function contextFacts(input: IssueBodyInput, { short = false } = {}): ContextFact[] {
  const rows: ContextFact[] = []
  const add = (key: string, label: string, value: string, code = true) => rows.push({ key, label, value, code })
  if (input.versionInfo) {
    if (input.versionInfo.version) add('version', 'Version', input.versionInfo.version)
    if (input.versionInfo.os) add('os', 'OS', input.versionInfo.os)
  }
  if (input.environment) {
    add('route', 'Route', input.environment.route)
    if (!short) {
      add('viewport', 'Viewport', `${input.environment.viewport.width}×${input.environment.viewport.height}`, false)
      add('locale', 'Locale', input.environment.locale)
    }
  }
  const el = input.element
  if (el) {
    if (el.chain.length) add('component', 'Component', el.chain.join(' › '))
    if (!short) {
      add('selector', 'Selector', el.selector)
      if (el.testId) add('testId', 'Test id', el.testId)
      add('boundingBox', 'Bounding box', `${el.rect.x}, ${el.rect.y}, ${el.rect.width}×${el.rect.height}`, false)
    }
    if (el.taskId) add('taskId', 'Task id', el.taskId)
    if (el.taskId && input.taskTitle) add('taskTitle', 'Task title', input.taskTitle)
  }
  return rows
}

export function contextRows(input: IssueBodyInput, options: { short?: boolean } = {}): Array<[string, string]> {
  return contextFacts(input, options).map((fact): [string, string] => [fact.label, fact.code ? code(fact.value) : fact.value])
}

/**
 * What the review step shows (#760): the same content the body carries, as plain lines. The body keeps its English
 * Markdown for the people who read the report; the user reads the description, the context facts and the log as they are.
 */
export function previewLines(input: IssueBodyInput): { description: string, facts: ContextFact[], log: { lines: number, text: string } | null } {
  const log = input.logTail?.trim() ? input.logTail.replace(/\s+$/, '') : null
  return {
    description: input.description.trim() ? input.description : '',
    facts: contextFacts(input),
    log: log ? { lines: log.split('\n').length, text: log } : null,
  }
}

export function contextSection(input: IssueBodyInput, options?: { short?: boolean }): string | null {
  const rows = contextRows(input, options)
  if (!rows.length) return null
  return ['## Context', '', '| Item | Value |', '| --- | --- |', ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`)].join('\n')
}

export function logSection(input: IssueBodyInput): string | null {
  if (!input.logTail?.trim()) return null
  const lines = input.logTail.replace(/\s+$/, '').split('\n').length
  const fence = fenceFor(input.logTail)
  return [`<details>`, `<summary>Log (last ${lines} lines)</summary>`, '', `${fence}text`, input.logTail.replace(/\s+$/, ''), fence, '', '</details>'].join('\n')
}

/**
 * One block after the description. Upload: the image (viewable for repo members), the plain path and
 * a one-line `gh api` hint for agents. Clipboard: a single line, the author pastes the image there.
 */
export function screenshotSection(input: IssueBodyInput): string | null {
  const shot = input.screenshot
  if (!shot) return null
  if (shot.delivery === 'clipboard') return 'Screenshot: paste it here (copied to the clipboard).'
  // Relay (#268): the image lives in the private feedback repository, on a branch of its own (#744: deletable).
  const [repo, branch] = shot.delivery === 'relay' ? [FEEDBACK_RELAY_REPO, relayScreenshotBranch(shot.path)] : [FEEDBACK_REPO, FEEDBACK_ASSETS_BRANCH]
  return [
    `![Screenshot](https://github.com/${repo}/blob/${branch}/${shot.path}?raw=true)`,
    '',
    `Path: \`${shot.path}\` on \`${branch}\``,
    `Agents: \`gh api repos/${repo}/contents/${shot.path}?ref=${branch}\``,
  ].join('\n')
}

export function footer(input: IssueBodyInput): string {
  const version = input.versionInfo?.version
  return `_Filed from kan-do${version ? ` v${version}` : ''} via in-app feedback_`
}

export function buildIssueBody(input: IssueBodyInput, options: { short?: boolean, withLog?: boolean, withContext?: boolean } = {}): string {
  const { short = false, withLog = true, withContext = true } = options
  const parts: Array<string | null> = [
    '## Description',
    // Verbatim: an empty description stays an explicit marker, never silently dropped.
    input.description.trim() ? input.description : '_No description._',
    screenshotSection(input),
    withContext ? contextSection(input, { short }) : null,
    withLog ? logSection(input) : null,
    footer(input),
  ]
  // `## Description` and its text form one block; every other part is its own block.
  const [heading, text, ...rest] = parts
  return [`${heading}\n\n${text}`, ...rest.filter((p): p is string => !!p)].join('\n\n') + '\n'
}
