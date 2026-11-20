<!--
@component CommandPalette
@kind component
@category navigation
@description Cmd/Ctrl+K command palette: app-wide commands in four groups (Aktionen, Gehe zu, Daten & Speicher, and on desktop App;
#234) plus actions for the card that held keyboard focus when the palette opened (issue #101, Direction B; on every page since #224).
The row that would navigate to the page the user is already on is left out (`buildCommandGroups`, `currentPath`).
@usage Mounted once in app.vue while the app bar shows (not on /welcome); open with Cmd/Ctrl+K or the ⋯ panel's "Befehle". No tap entry on a phone (MorePanel hides "Befehle" there); the keyboard opens it on any width.
@avoid Not for pointer navigation (AppNav, MorePanel); there is no tap entry on a phone. Rows keep the 44 px floor below md for Cmd/Ctrl+K in a narrow window and for a later phone entry (#345).
@responsibility
- Render UCommandPalette inside UModal; Esc closes and focus returns to the card
- Show the shortcut hints of the commands (`kbds`) and the palette's own keys in the footer
- The "focus a task with Tab" hint only on the board, the one place a card can have focus
- One height (#601): the panel is `h-144` (capped by the window) with and without a result, so typing never resizes it; the list scrolls and the empty line shows inside it
- Empty and loading states; screen-reader result status via role="status"
- The heading of the card's move group names the card ("Verschieben: {title}"), so it is `data-private` and masked in a feedback screenshot (#254); the app groups' headings are not
-->
<template>
  <UModal
    v-model:open="isOpen"
    :title="t('commandPalette.title')"
    :description="t('commandPalette.description')"
    :ui="modalUi"
    @after:leave="restoreFocus"
  >
    <template #content>
      <UCommandPalette
        :groups="groups"
        :loading="tasksStore.isLoading"
        :placeholder="t('commandPalette.placeholder')"
        :back="false"
        :fuse="fuseOptions"
        class="h-144 max-h-[calc(100dvh-6rem)]"
        @update:open="isOpen = $event"
      >
        <template #empty="{ searchTerm }">
          <EmptyNote role="status" class="px-4 py-6">
            {{ t('commandPalette.empty', { term: searchTerm }) }}
          </EmptyNote>
        </template>
        <!-- The card group's heading names the card ("Verschieben: {title}"): task text, masked in a feedback screenshot (#254). The app groups' headings are app copy. -->
        <template #group-label="{ group, label }">
          <span :data-private="group.id === 'card-move' ? '' : undefined">{{ label }}</span>
        </template>
        <template #footer>
          <p v-if="onBoard && !hasCard" class="px-3 pt-2 text-xs text-muted">
            {{ t('commandPalette.noCardHint') }}
          </p>
          <div class="flex items-center gap-4 px-3 py-2 text-xs text-muted">
            <span class="inline-flex items-center gap-1">
              <UKbd value="arrowup" /><UKbd value="arrowdown" />
              {{ t('commandPalette.hintNavigate') }}
            </span>
            <span class="inline-flex items-center gap-1">
              <UKbd value="enter" />
              {{ t('commandPalette.hintRun') }}
            </span>
            <span class="inline-flex items-center gap-1">
              <UKbd value="escape" />
              {{ t('commandPalette.hintClose') }}
            </span>
          </div>
        </template>
      </UCommandPalette>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import EmptyNote from '~/components/ui/EmptyNote.vue'
import { useTasksStore } from '~/store/tasks'
import { useCommandPalette } from '~/composables/useCommandPalette'
import { useAppNav } from '~/composables/useAppNav'

defineOptions({ name: 'CommandPalette' })

const { t } = useI18n()
const tasksStore = useTasksStore()

const { onBoard } = useAppNav()
const { isOpen, groups, hasCard, restoreFocus } = useCommandPalette()

// Cmd/Ctrl+K is registered in app.vue: this component loads on first open (#288).

// Placement only: the palette's look (Variant B "Quiet Desk": group headings, rows, highlight) is the `commandPalette` theme in app.config.ts.
const modalUi = {
  // A click on the scrim in the desktop bar row must dismiss it, not start a window drag (#432, lib/windowDrag.ts)
  overlay: 'window-drag-exempt',
  content: 'sm:top-20 sm:translate-y-0 sm:max-w-xl overflow-hidden',
}
// Replaces Nuxt UI's defaults wholesale, so repeat them (strict threshold keeps "erledigt" off the Wartet row).
const fuseOptions = {
  fuseOptions: { ignoreLocation: true, threshold: 0.1, keys: ['label', 'description', 'suffix'] },
  resultLimit: 30,
  matchAllWhenSearchEmpty: true,
}
</script>
