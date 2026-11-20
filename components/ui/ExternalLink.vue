<!--
@component ExternalLink
@kind primitive
@category action
@description Link to an external page. In the desktop app it opens in the system browser through
tauri-plugin-opener (narrow URL permission in src-tauri/capabilities); on web it is a plain
`<a target="_blank">`.
@usage <ExternalLink href="https://www.notion.so/my-integrations">Manage token</ExternalLink>
@avoid Only for pages outside the app (opens the system browser on desktop); in-app links use NuxtLink.
@responsibility
- Keep the href real so middle-click, copy-link and screen readers behave on web
- `standalone` (a help line that is only the link): on a phone a 44 px high row (DESIGN.md "Space, size and shape", #592). A link inside a sentence stays inline text: WCAG 2.5.8 exempts it, and padding around an inline box cannot reach 44 px under a field above it (measured, #592)
- Hand the URL to the opener plugin on desktop instead of navigating the webview
- Report an opener failure through useErrorHandler (context `external_link`), never swallow it
- Open outside or inside (moved from DESIGN.md, D1 on kd#68): `ICONS.external` means "opens outside the app" and is bound to this component; opening details inside the app uses `ICONS.openDetail`. Named exceptions that carry the icon without `ExternalLink`: the feedback dialog's own buttons (`FeedbackDialog.vue`, `useFeedback` `openExternal`), toast actions and the task sheet menu's "open in source" (through `utils/openExternal.ts`)
-->
<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    :class="standalone ? 'max-md:inline-flex max-md:min-h-11 max-md:items-center' : ''"
    class="text-link"
    @click="open"
  >
    <slot />
  </a>
</template>

<script setup lang="ts">
import { isTauri } from '~/utils/isTauri';
import { openExternal } from '~/utils/openExternal';

defineOptions({ name: 'ExternalLink' });

interface Props {
  href: string;
  /** The link is a line of its own (a help line under a field): on a phone it is a 44 px high row, not padding around the text */
  standalone?: boolean;
}

const props = withDefaults(defineProps<Props>(), { standalone: false });

function open(event: MouseEvent) {
  // On web the anchor's own navigation (new tab, middle-click, copy-link) stays; only the desktop webview is redirected.
  if (!isTauri()) return;
  event.preventDefault();
  void openExternal(props.href);
}
</script>
