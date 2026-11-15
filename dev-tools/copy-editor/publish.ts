/**
 * @module copy-editor/publish
 * @description The Publish flow of the live copy editor (#59, decisions D2/D6): one batch translation of every edit
 * whose other language is left to the agent, a review of the drafts, then the publish: the change lands on main with its tests (#340), or on a `copy/...` PR when a step fails. Both steps are explicit; nothing
 * is pushed before the designer has seen the drafts. Failures keep every edit.
 * @responsibility Phase, errors and results of translate/push. State only; calls `api.ts`.
 */
import { ref } from 'vue'
import { requestPublish, requestTranslation, type PublishResponse } from './api'
import { baseValue, edits, markPublished, needsTranslation, pendingEdits, setDraft, type Lang } from './edits'

export type Phase = 'idle' | 'translating' | 'publishing'

export const phase = ref<Phase>('idle')
export const errors = ref<string[]>([])
export const result = ref<Extract<PublishResponse, { ok: true }> | null>(null)
/** The running publish job's stage and notes (#340), shown while `phase` is `publishing`. */
export const progress = ref<{ stage: string | null, notes: string[] }>({ stage: null, notes: [] })

export async function translateDrafts(): Promise<void> {
  const items = needsTranslation.value.map(entry => ({ key: entry.key, from: entry.written, value: entry[entry.written] }))
  if (!items.length || phase.value !== 'idle') return
  phase.value = 'translating'
  errors.value = []
  const response = await requestTranslation(items)
  if (!response.ok) {
    errors.value = response.errors
  } else {
    for (const item of items) {
      const draft = response.drafts[item.key]
      if (draft?.text) setDraft(item.key, draft.text)
      else setDraft(item.key, null, draft?.problems ?? ['no draft'])
    }
  }
  phase.value = 'idle'
}

export async function publishEdits(): Promise<void> {
  if (phase.value !== 'idle' || needsTranslation.value.length > 0 || pendingEdits.value.length === 0) return
  phase.value = 'publishing'
  errors.value = []
  result.value = null
  progress.value = { stage: null, notes: [] }
  const keys = pendingEdits.value.map(entry => entry.key)
  const response = await requestPublish(keys.map((key) => {
    const entry = edits.value[key]!
    // Only languages that differ from the bundled text are changes; the server keeps origin/main's text for the rest.
    const changed = (['de', 'en'] as Lang[]).filter(lang => entry[lang] !== baseValue(key, lang))
    return { key, de: entry.de, en: entry.en, changed }
  }), (status) => { progress.value = status })
  if (response.ok) {
    result.value = response
    markPublished(keys, response.landed === 'main' ? `main@${response.commit?.slice(0, 7) ?? ''}` : response.prUrl ?? response.branch ?? 'copy branch')
  } else {
    errors.value = response.step ? [`Publish stopped at "${response.step}":`, ...response.errors] : response.errors
  }
  phase.value = 'idle'
}

export function resetPublishState(): void {
  errors.value = []
  result.value = null
}

