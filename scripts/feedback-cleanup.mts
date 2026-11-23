/**
 * Feedback retention cleanup (#744): deletes relayed feedback `FEEDBACK_RETENTION_DAYS` after its issue was closed, from
 * the private repository `jaylouiz/kan-do-feedback`: the issue (GraphQL `deleteIssue`, needs admin rights on the
 * repository, so it runs with the maintainer's own `gh` login) and its screenshot branch `screenshot/<uuid>`; open issues
 * stay. Screenshot branches no issue names (a report whose issue was never created) go after the same period. A deleted branch leaves
 * its image in no reachable history. Procedure, schedule and the one-time cleanup of older images:
 * `docs/feedback-retention.md`.
 *
 * Usage:
 *   npm run feedback:cleanup                 # dry run: lists what would go
 *   npm run feedback:cleanup -- --apply      # deletes it
 *   npm run feedback:cleanup -- --repo owner/name --days 30
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { FEEDBACK_RETENTION_DAYS, RELAY_SCREENSHOT_BRANCH_PREFIX, retentionCutoff } from '../lib/feedback/retention.ts'

export interface IssueEntry { number: number, nodeId: string, closedAt: string | null, body: string, isPullRequest: boolean }
export interface BranchEntry { ref: string, committedAt: string }

const SCREENSHOT_BRANCH = new RegExp(`${RELAY_SCREENSHOT_BRANCH_PREFIX}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`, 'g')

/** The screenshot branches an issue body names (the relay writes `on \`screenshot/<uuid>\``). */
export function screenshotBranchesOf(body: string): string[] {
  return [...new Set(body.match(SCREENSHOT_BRANCH) ?? [])]
}

/** Issues closed before the cutoff; open issues and pull requests stay. */
export function expiredIssues(issues: IssueEntry[], cutoff: Date): IssueEntry[] {
  return issues.filter(issue => !issue.isPullRequest && issue.closedAt !== null && Date.parse(issue.closedAt) < cutoff.getTime())
}

/**
 * The screenshot branches to delete: those of the expired issues, plus orphans (no remaining issue names them, e.g. a
 * report whose issue was never created) older than the cutoff. A branch a kept issue names is never deleted.
 */
export function expiredBranches(branches: BranchEntry[], issues: IssueEntry[], cutoff: Date): BranchEntry[] {
  const expired = new Set(expiredIssues(issues, cutoff).map(issue => issue.number))
  const ofExpired = new Set(issues.filter(issue => expired.has(issue.number)).flatMap(issue => screenshotBranchesOf(issue.body)))
  const ofKept = new Set(issues.filter(issue => !expired.has(issue.number)).flatMap(issue => screenshotBranchesOf(issue.body)))
  return branches.filter((branch) => {
    if (!branch.ref.startsWith(`refs/heads/${RELAY_SCREENSHOT_BRANCH_PREFIX}`)) return false
    const name = branch.ref.replace('refs/heads/', '')
    if (ofKept.has(name)) return false
    return ofExpired.has(name) || Date.parse(branch.committedAt) < cutoff.getTime()
  })
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function ghJson<T>(args: string[]): T {
  return JSON.parse(gh(args)) as T
}

function listIssues(repo: string): IssueEntry[] {
  // --paginate --slurp: one JSON array of pages
  const pages = ghJson<Array<Array<{ number: number, node_id: string, closed_at: string | null, body: string | null, pull_request?: unknown }>>>(
    ['api', '--paginate', '--slurp', `repos/${repo}/issues?state=all&per_page=100`])
  return pages.flat().map(issue => ({ number: issue.number, nodeId: issue.node_id, closedAt: issue.closed_at, body: issue.body ?? '', isPullRequest: issue.pull_request !== undefined }))
}

function listScreenshotBranches(repo: string): BranchEntry[] {
  const refs = ghJson<Array<Array<{ ref: string, object: { sha: string } }>>>(
    ['api', '--paginate', '--slurp', `repos/${repo}/git/matching-refs/heads/${RELAY_SCREENSHOT_BRANCH_PREFIX}`]).flat()
  return refs.map((ref) => {
    const commit = ghJson<{ committer: { date: string } }>(['api', `repos/${repo}/git/commits/${ref.object.sha}`])
    return { ref: ref.ref, committedAt: commit.committer.date }
  })
}

/** Files the relay committed to the default branch before #744; they need a one-time history rewrite. */
function legacyImages(repo: string): string[] {
  try {
    const tree = ghJson<{ tree: Array<{ path: string, type: string }> }>(['api', `repos/${repo}/git/trees/HEAD?recursive=1`])
    return tree.tree.filter(entry => entry.type === 'blob' && entry.path.startsWith('feedback/')).map(entry => entry.path)
  }
  catch {
    return []
  }
}

function main(): void {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      repo: { type: 'string', default: 'jaylouiz/kan-do-feedback' },
      days: { type: 'string', default: String(FEEDBACK_RETENTION_DAYS) },
    },
  })
  const repo = values.repo
  const days = Number(values.days)
  if (!Number.isInteger(days) || days < 1) throw new Error(`--days must be a whole number of days, got ${values.days}`)
  const cutoff = retentionCutoff(new Date(), days)
  console.log(`${repo}: feedback closed before ${cutoff.toISOString()} (${days} days) ${values.apply ? 'is deleted' : 'would be deleted (dry run, --apply deletes)'}`)

  const all = listIssues(repo)
  const issues = expiredIssues(all, cutoff)
  // Branches first: the issue body is where their names are written
  const branches = expiredBranches(listScreenshotBranches(repo), all, cutoff)
  for (const branch of branches) {
    console.log(`branch ${branch.ref.replace('refs/heads/', '')} (${branch.committedAt})`)
    if (values.apply) gh(['api', '-X', 'DELETE', `repos/${repo}/git/${branch.ref}`])
  }
  for (const issue of issues) {
    console.log(`issue #${issue.number} (closed ${issue.closedAt})`)
    if (values.apply) gh(['api', 'graphql', '-f', 'query=mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }', '-f', `id=${issue.nodeId}`])
  }
  console.log(`${issues.length} issue(s), ${branches.length} screenshot branch(es)`)

  const legacy = legacyImages(repo)
  if (legacy.length) {
    console.log(`\n${legacy.length} image(s) from before #744 sit on the default branch (feedback/...). Deleting them needs the`)
    console.log('one-time history rewrite in docs/feedback-retention.md "Images from before #744".')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
