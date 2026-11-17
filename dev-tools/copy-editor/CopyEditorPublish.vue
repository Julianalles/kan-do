<!--
@component CopyEditorPublish
@description The Publish review of the live copy editor (#59, dev only): every collected edit with before and after
in both languages, the agent drafts marked, then two explicit steps: translate the agent languages, publish. Publish
(#340) lands the change on main with its tests; the running stage is shown while it works (minutes). Loading (translation or
publish running, with the stage), error (kept edits, step named), done on main (commit) and done on a `copy/...` PR (the
failed step named) states are shown here.
@usage Right pane of CopyEditorDialog in its "publish" view.
@responsibility Present edits and drive `publish.ts`. Never pushes before the drafts have been shown.
-->
<template>
  <div class="flex flex-col gap-3 p-4" data-testid="copy-editor-publish-view">
    <p class="text-sm" data-testid="copy-editor-count">
      <template v-if="pendingEdits.length">{{ pendingEdits.length }} {{ pendingEdits.length === 1 ? 'edit' : 'edits' }} in 2 files ({{ LOCALE_FILES }})</template>
      <template v-else>No edits to publish yet. Pick text on the page or press ⌥K and save an edit.</template>
    </p>

    <div v-if="pendingEdits.length" class="flex flex-wrap items-center gap-2">
      <UButton v-if="needsTranslation.length" color="neutral" :loading="phase === 'translating'" :disabled="phase !== 'idle'" icon="i-ph-translate" data-testid="copy-editor-translate" @click="translateDrafts">
        {{ phase === 'translating' ? 'Agent is translating…' : `Translate ${needsTranslation.length} with the agent` }}
      </UButton>
      <UButton color="primary" :loading="phase === 'publishing'" :disabled="phase !== 'idle' || needsTranslation.length > 0" icon="i-ph-rocket-launch" data-testid="copy-editor-push" :aria-describedby="needsTranslation.length ? 'copy-editor-push-reason' : undefined" @click="publishEdits">
        {{ phase === 'publishing' ? 'Publishing…' : 'Publish to main' }}
      </UButton>
      <p v-if="needsTranslation.length" id="copy-editor-push-reason" class="w-full text-sm text-default" data-testid="copy-editor-push-reason">Publish is blocked: {{ needsTranslation.length }} {{ needsTranslation.length === 1 ? 'edit has' : 'edits have' }} a language not translated yet. {{ phase === 'translating' ? 'The agent is translating now; then review the drafts below.' : 'Click “Translate”, review the drafts below, then publish.' }}</p>
    </div>

    <div v-if="phase === 'publishing'" class="rounded-lg border border-default p-3 text-sm" role="status" data-testid="copy-editor-progress">
      <p>Publishing: {{ progress.stage ? STAGE_LABEL[progress.stage] ?? progress.stage : 'starting' }}…</p>
      <p v-for="line in progress.notes" :key="line" class="text-muted">{{ line }}</p>
    </div>

    <UAlert v-if="errors.length" color="error" variant="subtle" :ui="{ root: 'text-error-800', description: 'opacity-100' }" icon="i-ph-warning-circle" title="Not published, your edits are kept" data-testid="copy-editor-error">
      <template #description>
        <p v-for="line in errors" :key="line" class="whitespace-pre-wrap">{{ line }}</p>
      </template>
    </UAlert>

    <ul v-if="pendingEdits.length" class="flex flex-col gap-2">
      <li v-for="entry in pendingEdits" :key="entry.key" class="rounded-lg border border-default p-3 text-sm" :data-testid="`copy-editor-row-${entry.key}`">
        <p class="font-mono text-xs break-all text-muted">{{ entry.key }}</p>
        <p v-for="lang in LANGS" :key="lang" class="mt-1">
          <span class="font-medium">{{ lang.toUpperCase() }}</span>
          <template v-if="entry[lang] === baseValue(entry.key, lang)">
            <span class="text-muted"> · {{ entry.written === lang ? 'unchanged' : 'not translated yet (agent)' }}</span>
          </template>
          <template v-else>
            · <del class="text-muted">{{ baseValue(entry.key, lang) }}</del> → <ins class="no-underline">{{ entry[lang] }}</ins>
            <UBadge v-if="entry.written !== lang && entry.other === 'draft'" color="warning" variant="subtle" size="sm" class="ml-1">agent draft</UBadge>
          </template>
        </p>
        <p v-if="entry.draftProblems?.length" class="mt-1 text-error-700">Draft rejected: {{ entry.draftProblems.join('; ') }}. Write it yourself in the editor or retry.</p>
        <UButton type="button" size="xs" color="neutral" variant="link" class="mt-1 -ml-1" @click="openEditor(entry.key)">Edit</UButton>
      </li>
    </ul>

    <UAlert v-if="result && result.landed === 'main'" color="success" variant="subtle" :ui="{ root: 'text-success-800', description: 'opacity-100' }" icon="i-ph-check-circle" :title="`Published ${result.edits} ${result.edits === 1 ? 'edit' : 'edits'} on main (${result.commit?.slice(0, 7)})`" data-testid="copy-editor-done">
      <template #description>
        <p>{{ result.files }} files in the commit; the tests follow the new copy.</p>
        <p v-if="result.followUp.rewritten.length">{{ result.followUp.rewritten.length }} tests and snapshots rewritten.</p>
        <p v-if="result.followUp.baselines.length">{{ result.followUp.baselines.length }} baselines re-recorded.</p>
        <p v-for="repair in result.followUp.repairs" :key="repair.round">Agent repair, round {{ repair.round }}: {{ repair.notes }}</p>
        <p v-for="warning in result.warnings" :key="warning">{{ warning }}</p>
      </template>
    </UAlert>

    <UAlert v-else-if="result" color="warning" variant="subtle" :ui="{ root: 'text-warning-800', description: 'opacity-100' }" icon="i-ph-git-pull-request" :title="`Not on main: the &quot;${result.failure?.stage}&quot; step failed, a PR waits for you`" data-testid="copy-editor-done">
      <template #description>
        <a v-if="result.prUrl" :href="result.prUrl" target="_blank" rel="noopener" class="underline">{{ result.prUrl }}</a>
        <p v-else>Branch {{ result.branch }}</p>
        <p v-if="result.note">{{ result.note }}</p>
        <p v-for="line in result.failure?.errors ?? []" :key="line" class="whitespace-pre-wrap">{{ line }}</p>
        <p v-for="warning in result.warnings" :key="warning">{{ warning }}</p>
      </template>
    </UAlert>

    <div v-if="publishedEdits.length" class="flex flex-wrap items-center gap-2 border-t border-default pt-3 text-sm text-muted">
      <p>{{ publishedEdits.length }} published, still shown in the app.</p>
      <UButton type="button" size="xs" color="neutral" variant="link" data-testid="copy-editor-clear-published" @click="clearPublished">Clear published</UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { baseValue, clearPublished, needsTranslation, openEditor, pendingEdits, publishedEdits, type Lang } from './edits'
import { errors, phase, progress, publishEdits, result, translateDrafts } from './publish'

defineOptions({ name: 'CopyEditorPublish' })

const LANGS: Lang[] = ['de', 'en']
const LOCALE_FILES = 'de.json, en.json'
const STAGE_LABEL: Record<string, string> = {
  prepare: 'preparing a clean copy of main',
  check: 'checking the locale files',
  rewrite: 'updating the tests to the new copy',
  verify: 'running lint, types and unit tests',
  specs: 'building the app and running the E2E specs',
  baselines: 'recording the changed baselines',
  repair: 'the agent is repairing tests',
  push: 'pushing to main',
}
</script>
