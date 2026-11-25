/**
 * Playwright reporter of the pre-merge E2E gate (#830): records which tests ended well, so a gate run that times out
 * (or fails) keeps its progress and the next run of the same PR head and spec list runs only the spec files left.
 * The hook adds it next to the `line` reporter (`--reporter=line,<this file>`) and names the output in
 * `E2E_GATE_PROGRESS`; without that variable it records nothing. Every line is appended synchronously, so a run the
 * watchdog kills keeps what it recorded. Line shapes (JSON per line), read by `parseProgress` in `scripts/e2e-gate.mjs`:
 *   {"begin":{"<spec name>":<test count>,...}}   once per run: how many tests each spec file holds
 *   {"ok":"<spec name>","id":"<test id>"}        an attempt that ended as the test expects (passed, also on retry,
 *                                                 a test.skip(), a test.fail() that failed); a failed, killed or
 *                                                 not-run attempt writes none
 */
import { appendFileSync } from 'node:fs'
import { basename } from 'node:path'

const SPEC_SUFFIX = '.spec.ts'

/** Spec basename without `.spec.ts` of a test file path (`null` for anything else). */
const specOf = file => (file.endsWith(SPEC_SUFFIX) ? basename(file).slice(0, -SPEC_SUFFIX.length) : null)

export default class GateProgressReporter {
  constructor() {
    this.out = process.env.E2E_GATE_PROGRESS || ''
  }

  /** @param {string} line */
  write(line) {
    if (!this.out) return
    try {
      appendFileSync(this.out, `${line}\n`)
    } catch {
      // progress is a saving, never a reason to fail the run
    }
  }

  onBegin(_config, suite) {
    /** @type {Record<string, number>} */
    const counts = {}
    for (const test of suite.allTests()) {
      const spec = specOf(test.location.file)
      if (spec) counts[spec] = (counts[spec] ?? 0) + 1
    }
    this.write(JSON.stringify({ begin: counts }))
  }

  onTestEnd(test, result) {
    // The attempt ended as the test expects (passed, a test.skip(), a test.fail() that failed). Not `test.outcome()`: it
    // calls a killed (`interrupted`) test and one that did not run after a serial failure `skipped`.
    const spec = specOf(test.location.file)
    if (spec && result.status === test.expectedStatus) this.write(JSON.stringify({ ok: spec, id: test.id }))
  }

  printsToStdio() {
    return false
  }
}
