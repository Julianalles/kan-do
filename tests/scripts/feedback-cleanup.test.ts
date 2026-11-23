// @vitest-environment node
/**
 * #744: feedback is deleted 30 days after its issue was closed (maintainer's decision, 2026-11-23); open issues stay. The
 * screenshot branch goes with its issue, an orphan branch after the same period, and no other branch is ever touched.
 */
import { describe, expect, it } from 'vitest'
import { expiredBranches, expiredIssues, screenshotBranchesOf, type IssueEntry } from '../../scripts/feedback-cleanup.mts'
import { FEEDBACK_RETENTION_DAYS, relayScreenshotBranch, retentionCutoff } from '~/lib/feedback/retention'
import { buildIssueBody } from '~/lib/feedback/buildIssueBody'

const NOW = new Date('2026-11-23T12:00:00Z')
const cutoff = retentionCutoff(NOW)
const UUID_A = '0b6f3c1e-8a55-4d0a-9c1b-2f6f0a4d9e11'
const UUID_B = '1c7f4d2f-9b66-4e1b-8d2c-3f7f1b5e0f22'
const UUID_C = '2d8f5e3f-ac77-4f2c-9e3d-4f8f2c6f1f33'
const bodyWith = (uuid: string) => buildIssueBody({ description: 'x', screenshot: { delivery: 'relay', path: `feedback/2026/09/${uuid}.png` } })

const issue = (number: number, closedAt: string | null, body = '', isPullRequest = false): IssueEntry =>
  ({ number, nodeId: `n${number}`, closedAt, body, isPullRequest })

describe('feedback retention', () => {
  it('keeps feedback 30 days after the issue is closed', () => {
    expect(FEEDBACK_RETENTION_DAYS).toBe(30)
    expect(cutoff.toISOString()).toBe('2026-10-24T12:00:00.000Z')
  })

  it('names one branch per screenshot after its uuid, and finds it again in the issue body the relay files', () => {
    expect(relayScreenshotBranch(`feedback/2026/11/${UUID_A}.png`)).toBe(`screenshot/${UUID_A}`)
    expect(screenshotBranchesOf(bodyWith(UUID_A))).toEqual([`screenshot/${UUID_A}`])
    expect(screenshotBranchesOf('no image')).toEqual([])
  })

  it('selects issues closed before the cutoff; open issues and pull requests stay', () => {
    const issues = [
      issue(1, '2026-10-24T11:59:59Z'),
      issue(2, '2026-10-24T12:00:00Z'),
      issue(3, null),
      issue(4, '2025-01-01T00:00:00Z', '', true),
    ]
    expect(expiredIssues(issues, cutoff).map(entry => entry.number)).toEqual([1])
  })

  it('deletes the screenshot with its issue, keeps one a kept issue names, and touches no other branch', () => {
    const issues = [
      issue(1, '2026-10-01T00:00:00Z', bodyWith(UUID_A)), // closed 53 days ago: goes
      issue(2, null, bodyWith(UUID_B)), // open: its image stays however old
    ]
    const branches = [
      { ref: `refs/heads/screenshot/${UUID_A}`, committedAt: '2026-09-01T00:00:00Z' },
      { ref: `refs/heads/screenshot/${UUID_B}`, committedAt: '2026-01-01T00:00:00Z' },
      { ref: `refs/heads/screenshot/${UUID_C}`, committedAt: '2026-09-01T00:00:00Z' }, // orphan, old: goes
      { ref: 'refs/heads/screenshot/fresh-orphan', committedAt: '2026-11-20T00:00:00Z' }, // orphan, recent: stays
      { ref: 'refs/heads/main', committedAt: '2020-01-01T00:00:00Z' },
    ]
    expect(expiredBranches(branches, issues, cutoff).map(branch => branch.ref)).toEqual([
      `refs/heads/screenshot/${UUID_A}`,
      `refs/heads/screenshot/${UUID_C}`,
    ])
  })
})
