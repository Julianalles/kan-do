<!--
@component ResponsiveOverlay
@kind compound
@category overlay
@description The one overlay shell of the app: a centred modal (or a right-hand slideover) from 768px up, a bottom drawer below. The day close dialog and the task sheet are its hosts (#555, U12).
@usage `<ResponsiveOverlay :open="..." :title="..." @update:open="...">` with `#body` and optionally `#title`, `#description`, `#footer`. `desktop="slideover"` swaps the modal for a side sheet. The per-variant look stays with the host (`desktopUi`, `mobileUi`, `closeButton`); this component owns only the choice and the lifecycle.
@avoid The one overlay shell; a confirmation without a drawer variant may use a plain UModal.
@responsibility
- Picks modal/slideover vs drawer from `useIsDesktop()` and freezes the choice while the overlay is open: swapping shells would remount the hosted content and drop drafts. A resize while open takes effect after the overlay has left
- Provides the frozen choice to hosted content (`useOverlayIsDesktop()`), and passes it to the `#body` and `#footer` slots as `isDesktop`
- Open/close echo guard: vaul's DrawerRoot emits `update:open` with its current value on mount (page load at 390px, resize across the breakpoint). Only a value that differs from `open` is forwarded; without it a closed drawer reported `false` and a host started a close nobody asked for
- `after-leave` fires for every variant
- Focus into the drawer (#566): vaul cancels reka's open auto-focus (to keep the mobile keyboard closed), so the drawer never took focus and reka's trap never engaged. The drawer variant moves focus onto the drawer itself once it is mounted and again when its enter animation ends, unless hosted content already focused something inside (the task add form focuses its title field) or focus has moved on to another layer meanwhile (a picker popover the sheet opened: the late enter-end must not take it back, #722); it takes only focus that is on <body> or still on the element that held it at open. The modal and slideover need none: reka focuses them. Hosts do not handle this
- Browser bar tint (#554): while the drawer variant is open it sets `<meta name="theme-color">` to the sheet white so the phone's browser bars blend into the drawer; closing or unmounting removes the meta, so the browser samples the page again. The modal and slideover never set it
- Focus handling (Escape guards, focus return) is the host's, handed in as `contentProps`
-->
<template>
  <UModal
    v-if="isDesktop && desktop === 'modal'"
    :open="open"
    :title="title"
    :close="closeButton"
    :content="contentProps"
    :ui="desktopUi"
    @update:open="handleOpenChange"
    @after:leave="handleAfterLeave"
  >
    <template v-if="$slots.title" #title>
      <slot name="title" />
    </template>
    <template v-if="$slots.description" #description>
      <slot name="description" />
    </template>
    <template #body>
      <slot name="body" :is-desktop="true" />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" :is-desktop="true" />
    </template>
  </UModal>

  <USlideover
    v-else-if="isDesktop"
    :open="open"
    side="right"
    :title="title"
    :close="closeButton"
    :content="contentProps"
    :ui="desktopUi"
    @update:open="handleOpenChange"
    @after:leave="handleAfterLeave"
  >
    <template v-if="$slots.title" #title>
      <slot name="title" />
    </template>
    <template v-if="$slots.description" #description>
      <slot name="description" />
    </template>
    <template #body>
      <slot name="body" :is-desktop="true" />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" :is-desktop="true" />
    </template>
  </USlideover>

  <UDrawer
    v-else
    :open="open"
    direction="bottom"
    :title="title"
    :content="contentProps"
    :ui="drawerUi"
    @update:open="handleOpenChange"
    @after:enter="focusIntoDrawer"
    @after:leave="handleAfterLeave"
  >
    <template v-if="$slots.title" #title>
      <slot name="title" />
    </template>
    <template v-if="$slots.description" #description>
      <slot name="description" />
    </template>
    <template #body>
      <slot name="body" :is-desktop="false" />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" :is-desktop="false" />
    </template>
  </UDrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, provide, readonly, ref, watch } from 'vue';
import { OVERLAY_DESKTOP_KEY, useIsDesktop } from '~/composables/useIsDesktop';

defineOptions({ name: 'ResponsiveOverlay' });

type OverlayUi = Record<string, string | undefined>;

interface Props {
  /** Whether the overlay is open. The host owns this state. */
  open: boolean;
  /** Dialog title (the accessible name, also when a `#title` slot styles it). */
  title: string;
  /** What the desktop variant is: a centred modal or a right-hand slideover. */
  desktop?: 'modal' | 'slideover';
  /** `ui` slots of the desktop variant (width, body, footer classes). */
  desktopUi?: OverlayUi;
  /** `ui` slots of the drawer, merged over the shared container. */
  mobileUi?: OverlayUi;
  /** Close button of the desktop variant. The drawer has none (swipe down). */
  closeButton?: boolean;
  /** Dismiss hooks of the dialog content (`onEscapeKeyDown`, `onCloseAutoFocus`, ...). */
  contentProps?: Record<string, unknown>;
}

const props = withDefaults(defineProps<Props>(), {
  desktop: 'modal',
  desktopUi: () => ({}),
  mobileUi: () => ({}),
  closeButton: true,
  contentProps: () => ({}),
});

const emit = defineEmits<{
  'update:open': [value: boolean];
  'after-leave': [];
}>();

defineSlots<{
  title?(): unknown;
  description?(): unknown;
  body(props: { isDesktop: boolean }): unknown;
  footer?(props: { isDesktop: boolean }): unknown;
}>();

const viewportDesktop = useIsDesktop();
/** The variant on screen. Follows the viewport only while the overlay is closed or gone. */
const isDesktop = ref(viewportDesktop.value);
provide(OVERLAY_DESKTOP_KEY, readonly(isDesktop));

watch(viewportDesktop, (value) => {
  if (!props.open) isDesktop.value = value;
});

const handleAfterLeave = () => {
  // The overlay is gone now: a resize across the breakpoint while it was open takes effect for the next open
  isDesktop.value = viewportDesktop.value;
  emit('after-leave');
};

/** What held focus when the drawer opened (the trigger behind it); read in setup too, for a host that mounts it already open (a route to a task). */
let focusAtOpen: Element | null = props.open && typeof document !== 'undefined' ? document.activeElement : null;

/**
 * Idempotent: does nothing once focus is inside the drawer, so the two triggers below never fight. It only takes focus that is
 * nowhere or still behind the drawer (`<body>`, the element that held it at open): focus that moved on since, e.g. into a popover
 * the sheet opened (portalled outside the drawer), is not ours to take. The enter animation's end can come late under load, after
 * the user already opened a picker (#722).
 */
const focusIntoDrawer = () => {
  // A frame after Escape the drawer is still in the DOM, leaving: focus belongs to the trigger by then
  if (!props.open) return;
  const drawer = document.querySelector<HTMLElement>('[data-vaul-drawer][role="dialog"]');
  const active = document.activeElement;
  if (!drawer || drawer.contains(active)) return;
  if (active && active !== document.body && active !== focusAtOpen) return;
  drawer.focus({ preventScroll: true });
};

watch(() => props.open, async (isOpen) => {
  focusAtOpen = isOpen ? document.activeElement : null;
  // The variant is frozen while open and equals the viewport's at the moment it opens
  if (!isOpen || isDesktop.value) return;
  await nextTick();
  requestAnimationFrame(focusIntoDrawer);
});

/** The drawer's background, read from `--ui-bg` (a meta tag cannot use a CSS variable); a canvas-resolved colour, e.g. `rgb(255, 255, 255)`. */
const drawerThemeColor = () => {
  if (!import.meta.client) return undefined;
  const probe = document.createElement('div');
  probe.style.backgroundColor = 'var(--ui-bg)';
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
};

const drawerOpen = computed(() => props.open && !isDesktop.value);
let themeMeta: HTMLMetaElement | null = null;

const clearThemeColor = () => {
  themeMeta?.remove();
  themeMeta = null;
};

// Present only while the drawer is open (#554); removed on close and on unmount, so the browser samples the page again
watch(drawerOpen, (open) => {
  if (!import.meta.client) return;
  clearThemeColor();
  if (!open) return;
  themeMeta = document.createElement('meta');
  themeMeta.name = 'theme-color';
  themeMeta.content = drawerThemeColor() ?? '';
  document.head.appendChild(themeMeta);
}, { immediate: true });

onBeforeUnmount(clearThemeColor);

const drawerUi = computed<OverlayUi>(() => ({ container: 'min-h-0 gap-0 overflow-hidden p-0', ...props.mobileUi }));

/** Forward only real open-state changes (see the echo note in the doc block). */
const handleOpenChange = (value: boolean) => {
  if (value === props.open) return;
  emit('update:open', value);
};
</script>
