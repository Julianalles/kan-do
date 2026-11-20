import { ICONS } from './lib/icons'

// Button colour roles below AA (#97). `primary` and `error` soft are fixed one by one (#152, #594); the roles the app
// has no button for (`secondary`, `success`, `info`, `warning`) and the text variants of `error` are fixed here, the
// whole matrix is guarded by tests/config/button-contrast.test.ts. The class names are literals on purpose: Tailwind
// only generates what it can read in the source. Steps are the lightest that reach 4.5:1: white on the solid fill, the
// role text on the paper, the sheet and the role's 10% wash. Info needs 800 for text (700 is 4.43:1 on its hover wash
// over the paper); success keeps 800 for text and 700 as a fill; the press step is one deeper, like the primary's 600.
const BUTTON_ROLE_TEXT = {
  secondary: 'text-secondary-700',
  success: 'text-success-800',
  info: 'text-info-800',
  warning: 'text-warning-700',
  error: 'text-error-700'
} as const
const BUTTON_ROLE_LINK = {
  secondary: 'text-secondary-700 hover:text-secondary-800 active:text-secondary-800',
  success: 'text-success-800 hover:text-success-800 active:text-success-800',
  info: 'text-info-700 hover:text-info-800 active:text-info-800',
  warning: 'text-warning-700 hover:text-warning-800 active:text-warning-800',
  error: 'text-error-700 hover:text-error-800 active:text-error-800'
} as const
const BUTTON_ROLE_SOLID = {
  secondary: 'bg-secondary-700 enabled:hover:bg-secondary-800 enabled:active:bg-secondary-800',
  success: 'bg-success-700 enabled:hover:bg-success-800 enabled:active:bg-success-800',
  info: 'bg-info-700 enabled:hover:bg-info-800 enabled:active:bg-info-800',
  warning: 'bg-warning-700 enabled:hover:bg-warning-800 enabled:active:bg-warning-800'
} as const
const BUTTON_ROLES = ['secondary', 'success', 'info', 'warning'] as const
const BUTTON_TEXT_VARIANTS = ['outline', 'soft', 'subtle', 'ghost'] as const
const buttonRoleCompounds = [
  ...BUTTON_ROLES.flatMap((color) => [
    { color, variant: 'solid' as const, class: BUTTON_ROLE_SOLID[color] },
    ...BUTTON_TEXT_VARIANTS.map((variant) => ({ color, variant, class: BUTTON_ROLE_TEXT[color] })),
    { color, variant: 'link' as const, class: BUTTON_ROLE_LINK[color] }
  ]),
  // `error` keeps its own soft (above) and solid; the other text variants step to the same 700 as soft
  ...(['outline', 'subtle', 'ghost'] as const).map((variant) => ({ color: 'error' as const, variant, class: BUTTON_ROLE_TEXT.error })),
  { color: 'error' as const, variant: 'link' as const, class: BUTTON_ROLE_LINK.error }
]

// Badge and alert colour roles below AA (kd#123), same steps as the buttons above: the role text on the page, the
// sheet and the role's own 10% wash, white on the solid fill. No call site uses most of them today; the `/ui` matrix
// showed them and tests/config/role-contrast.test.ts guards the whole matrix. Literal class names, like above.
const ROLE_TEXT = {
  primary: 'text-primary-600',
  secondary: 'text-secondary-700',
  success: 'text-success-800',
  info: 'text-info-700',
  warning: 'text-warning-700',
  error: 'text-error-700'
} as const
// A notice is read, not scanned: its text takes the deeper 800 step the subtle alerts already use (#353, #368, #74)
const ALERT_ROLE_TEXT = {
  primary: 'text-primary-700',
  secondary: 'text-secondary-800',
  success: 'text-success-800',
  info: 'text-info-800',
  warning: 'text-warning-800',
  error: 'text-error-800'
} as const
const ROLE_FILL = {
  secondary: 'bg-secondary-700',
  success: 'bg-success-700',
  info: 'bg-info-700',
  warning: 'bg-warning-700'
} as const
const ROLE_NAMES = ['primary', 'secondary', 'success', 'info', 'warning', 'error'] as const
const ROLE_TEXT_VARIANTS = ['outline', 'soft', 'subtle'] as const
const badgeRoleCompounds = [
  ...ROLE_NAMES.flatMap((color) => ROLE_TEXT_VARIANTS.map((variant) => ({ color, variant, class: ROLE_TEXT[color] }))),
  ...(['secondary', 'success', 'info', 'warning'] as const).map((color) => ({ color, variant: 'solid' as const, class: ROLE_FILL[color] }))
]
const alertRoleCompounds = [
  ...ROLE_NAMES.flatMap((color) => ROLE_TEXT_VARIANTS.map((variant) => ({ color, variant, class: { root: ALERT_ROLE_TEXT[color] } }))),
  ...(['secondary', 'success', 'info', 'warning'] as const).map((color) => ({ color, variant: 'solid' as const, class: { root: ROLE_FILL[color] } }))
]

// The flat note (`variant="flat"` of the alert): the subtle wash without the ring. Literal class names, like above.
const ALERT_FLAT_WASH = {
  primary: 'bg-primary/10',
  secondary: 'bg-secondary/10',
  success: 'bg-success/10',
  info: 'bg-info/10',
  warning: 'bg-warning/10',
  error: 'bg-error/10'
} as const
const alertFlatCompounds = [
  ...ROLE_NAMES.map((color) => ({ color, variant: 'flat' as const, class: { root: `${ALERT_FLAT_WASH[color]} ${ALERT_ROLE_TEXT[color]}` } })),
  { color: 'neutral' as const, variant: 'flat' as const, class: { root: 'text-highlighted bg-elevated/50' } }
]

// Overlay motion (#601, DESIGN.md "Motion"): Nuxt UI's menus, dialogs and drawers run their keyframes on the library's own
// 100 and 200 ms and `--ease-out`; these strings put them on the app's tokens, so one clock moves everything. A menu, popover,
// select list or tooltip takes `--duration-fast`, a dialog (the command palette included) `--duration-base`; a menu pops from 98 % (`menu-in` / `menu-out`,
// transitions.css) where the library's 95 % moves a tall panel by 19 px, which the motion guard reads as a jump when frames
// are sparse; menus and dialogs use `--ease-standard` both ways; the scrim and the side sheet arrive on `--ease-emphasized` and leave on `--ease-standard`. Written out in full: Tailwind finds a class only as a whole string.
const MENU_MOTION = 'data-[state=open]:animate-[menu-in_var(--duration-fast)_var(--ease-standard)] data-[state=closed]:animate-[menu-out_var(--duration-fast)_var(--ease-standard)]'
const TOOLTIP_MOTION = 'data-[state=delayed-open]:animate-[menu-in_var(--duration-fast)_var(--ease-standard)] data-[state=closed]:animate-[menu-out_var(--duration-fast)_var(--ease-standard)]'
const SCRIM_MOTION = 'data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-emphasized)] data-[state=closed]:animate-[fade-out_var(--duration-base)_var(--ease-standard)]'
const DIALOG_MOTION = 'data-[state=open]:animate-[scale-in_var(--duration-base)_var(--ease-standard)] data-[state=closed]:animate-[scale-out_var(--duration-base)_var(--ease-standard)]'
const SIDE_MOTION = {
  top: 'data-[state=open]:animate-[slide-in-from-top_var(--duration-base)_var(--ease-emphasized)] data-[state=closed]:animate-[slide-out-to-top_var(--duration-base)_var(--ease-standard)]',
  right: 'data-[state=open]:animate-[slide-in-from-right_var(--duration-base)_var(--ease-emphasized)] data-[state=closed]:animate-[slide-out-to-right_var(--duration-base)_var(--ease-standard)]',
  bottom: 'data-[state=open]:animate-[slide-in-from-bottom_var(--duration-base)_var(--ease-emphasized)] data-[state=closed]:animate-[slide-out-to-bottom_var(--duration-base)_var(--ease-standard)]',
  left: 'data-[state=open]:animate-[slide-in-from-left_var(--duration-base)_var(--ease-emphasized)] data-[state=closed]:animate-[slide-out-to-left_var(--duration-base)_var(--ease-standard)]',
}

export default defineAppConfig({
  ui: {
    // tailwind-merge does not know our `--text-*` type roles (main.css `@theme`, #70): without this `text-label/3` reads as
    // a colour and Nuxt UI's own `text-[10px]/3` stays next to it. Keep in step with the roles; design-tokens.test.ts checks.
    tv: {
      twMergeConfig: { extend: { theme: { text: ['display', 'headline', 'title', 'label', 'brand', 'body', 'figure', 'figure-lg'] } } },
    },
    fonts: {
      sans: "var(--font-sans)",
      mono: "var(--font-mono)",
      display: "var(--font-display)",
    },
    colors: {
      primary: 'custom-forest',
      secondary: 'custom-orange',
      success: 'custom-forest',
      info: 'sky',
      warning: 'custom-orange',
      error: 'custom-raspberry',
      neutral: 'custom-paper',
    },
    radius: {
      sm: '0.25rem',
      md: '0.5rem', // 8px as agreed
      lg: '0.75rem',
      xl: '1rem'
    },
    // Nuxt UI defaults to Lucide, which is not installed: those icons would be fetched from
    // api.iconify.design at runtime (blocked by the desktop CSP, ADR 012). Every Nuxt UI default key
    // is mapped (tests/config/nuxt-ui-icons.test.ts guards it). Phosphor is the
    // design system's set and is bundled into the client (nuxt.config.ts `icon.clientBundle`).
    icons: {
      arrowDown: 'i-ph-arrow-down',
      arrowLeft: 'i-ph-arrow-left',
      arrowRight: 'i-ph-arrow-right',
      arrowUp: 'i-ph-arrow-up',
      caution: 'i-ph-warning-circle',
      check: 'i-ph-check',
      chevronDoubleLeft: 'i-ph-caret-double-left',
      chevronDoubleRight: 'i-ph-caret-double-right',
      chevronDown: 'i-ph-caret-down',
      chevronLeft: 'i-ph-caret-left',
      chevronRight: 'i-ph-caret-right',
      chevronUp: 'i-ph-caret-up',
      close: ICONS.close,
      copy: 'i-ph-copy',
      copyCheck: 'i-ph-check-square',
      dark: 'i-ph-moon',
      drag: 'i-ph-dots-six-vertical',
      ellipsis: 'i-ph-dots-three',
      error: 'i-ph-x-circle',
      external: ICONS.external,
      eye: 'i-ph-eye',
      eyeOff: 'i-ph-eye-slash',
      file: 'i-ph-file',
      folder: 'i-ph-folder',
      folderOpen: 'i-ph-folder-open',
      hash: 'i-ph-hash',
      info: 'i-ph-info',
      light: 'i-ph-sun',
      loading: 'i-ph-circle-notch',
      menu: 'i-ph-list',
      minus: 'i-ph-minus',
      panelClose: 'i-ph-sidebar-simple',
      panelOpen: 'i-ph-sidebar-simple',
      plus: 'i-ph-plus',
      reload: 'i-ph-arrow-counter-clockwise',
      search: 'i-ph-magnifying-glass',
      star: 'i-ph-star',
      stop: 'i-ph-square',
      success: 'i-ph-check-circle',
      system: 'i-ph-monitor',
      tip: 'i-ph-lightbulb',
      upload: 'i-ph-upload-simple',
      warning: 'i-ph-warning'
    },
    // Every overlay darkens the whole window by the shared scrim (`--overlay-scrim`), the task sheet included (#419).
    modal: {
      slots: {
        // Default width is the "md" step of the shared scale (utils/modalSizes.ts);
        // UModal's own divide-y draws the header/body/footer separators, softened
        // to half strength so sections read as zones, not hard splits.
        content: 'bg-elevated ring-1 ring-default divide-default/50 sm:max-w-lg',
        header: 'px-6 py-4',
        // Every dialog title is the subhead role in the display face (weight and tracking explicit so Nuxt UI's title
        // classes cannot override, DESIGN.md "Type"); custom in-body titles (task detail) use `font-display` too.
        title: 'font-display text-lg font-medium tracking-display',
        // Standard footer chrome: actions right-aligned. Wizards that need a
        // two-zone layout put a `flex w-full justify-between` div inside.
        footer: 'footer-actions px-6 py-4',
        // Dialog copy is the body role (reading text, 1.55); Nuxt UI sets `text-sm`
        description: 'text-body',
      },
      // The default scrim is the `overlay` variant (`bg-elevated/75`), which beats a slot override.
      // This variant must win over Nuxt UI's default bg-elevated/75; tests/e2e/overlay-scrim.spec.ts guards it.
      variants: {
        overlay: {
          true: { overlay: 'bg-(--overlay-scrim)' },
        },
        // The keyframes sit in Nuxt UI's `transition` variant, merged after the slots: the tokens go in the same place (#601)
        transition: {
          true: { overlay: SCRIM_MOTION, content: DIALOG_MOTION },
        },
        // Nuxt UI's `fullscreen: false` variant carries `shadow-lg` and is merged after slot overrides,
        // so the modal elevation (#126) has to override it here, not in `slots.content`.
        fullscreen: {
          false: { content: 'shadow-(--shadow-overlay)' },
        },
      },
    },
    // Task sheet sits above the app bar (z-40); popovers and tooltips opened inside it go above the sheet, toasts above both.
    slideover: {
      slots: {
        overlay: 'z-(--z-overlay)',
        content: 'z-(--z-overlay) bg-elevated md:shadow-(--shadow-sheet)',
        title: 'font-display text-lg font-medium tracking-display',
        description: 'text-body',
      },
      variants: {
        transition: {
          true: { overlay: SCRIM_MOTION },
        },
      },
      compoundVariants: (['top', 'right', 'bottom', 'left'] as const).map(side => ({ transition: true, side, class: { content: SIDE_MOTION[side] } })),
    },
    drawer: {
      slots: {
        overlay: 'z-(--z-overlay) bg-(--overlay-scrim)',
        content: 'z-(--z-overlay) bg-elevated',
        title: 'font-display text-lg font-medium tracking-display',
        description: 'text-body',
      }
    },
    // Menus, popovers and toasts are sheets: the 16 px radius (`rounded-lg`) and the warm overlay shadow replace Nuxt UI's `shadow-lg` in Tailwind's black
    // (DESIGN.md "Elevation"). A tooltip is a label, not a sheet: its ring is enough.
    popover: {
      slots: {
        content: `z-(--z-popover) rounded-lg shadow-(--shadow-overlay) ${MENU_MOTION}`
      }
    },
    tooltip: {
      slots: {
        content: `z-(--z-popover) shadow-none ${TOOLTIP_MOTION}`
      }
    },
    contextMenu: {
      slots: {
        content: `rounded-lg shadow-(--shadow-overlay) ${MENU_MOTION}`,
        // 40 px rows, centred (#296), at least 44 px below `md` (the phone floor, DESIGN.md "Space, size and shape", #342); the hand cursor is explicit, the disabled row keeps Nuxt UI's `not-allowed`
        item: 'min-h-10 max-md:min-h-11 items-center cursor-pointer'
      },
      variants: {
        // The highlight and the open submenu's parent row take the paper tone of a row's hover (DESIGN.md "Fill on a
        // sheet"): Nuxt UI's `bg-elevated` is white here, as white as the menu itself, so a row showed no hover (#296).
        // A disabled row is never highlighted (reka sets no `data-highlighted` on it): no hover answer, as DESIGN.md "States" says.
        active: {
          false: {
            item: 'data-highlighted:before:bg-muted data-[state=open]:before:bg-muted'
          }
        }
      }
    },
    // The combobox of the new-card flow's Thema and Aktivität steps (#434): a field like every field (`--field-h`, the `lg`
    // size, `text-muted` placeholder), its list a sheet above the cards below it (`z-(--z-popover)`, the warm overlay shadow),
    // rows 32 px (`min-h-8`), at least 44 px below `md` and centred (the phone floor, #342). The list holds about 5 rows, then scrolls.
    inputMenu: {
      slots: {
        // `max-md:pe-11`: the text stops before the 44 px chevron (the `lg` field's `pe-10` is 40 px)
        base: 'h-(--field-h) max-md:pe-11 disabled:cursor-not-allowed disabled:opacity-50',
        // The chevron button at the end is at least 44 px wide on a phone (it is `--field-h` high), its icon centred in it (#592)
        trailing: 'max-md:min-w-11 max-md:justify-center',
        // The chevron answers the pointer: its ink darkens (DESIGN.md "States", Hover: a text control darkens its text; #592)
        trailingIcon: 'group-hover:text-default',
        // About 5 rows, then it scrolls (`--combo-list-room`, assets/css/main.css; NewCardFlow lowers it above the on-screen keyboard)
        content: `z-(--z-popover) max-h-(--combo-list-room) rounded-lg shadow-(--shadow-overlay) ${MENU_MOTION}`,
        // The highlighted row (arrows, the first match while typing) takes the paper tone of a menu row's hover: Nuxt UI's `bg-elevated` is white here, as white as the list (DESIGN.md "Fill on a sheet", like `dropdownMenu` and `contextMenu`)
        item: 'min-h-8 max-md:min-h-11 max-md:items-center p-1.5 cursor-pointer data-highlighted:not-data-disabled:before:bg-muted'
      },
      variants: {
        // The single-select theme sets `placeholder:text-dimmed` on the base: `text-muted` is the placeholder of every field (2.5:1 is below AA, Receding Text Rule, #646)
        multiple: {
          false: {
            base: 'placeholder:text-muted'
          }
        }
      },
      defaultVariants: {
        size: 'lg'
      }
    },
    // Toasts (e.g. a failed save) must stay visible above the open task sheet.
    // `kando-toaster` lifts them above the phone app bar (assets/css/mobile-nav.css).
    toaster: {
      slots: {
        viewport: 'z-(--z-toast) kando-toaster'
      }
    },
    // Action buttons (undo for delete, archive, completion) get a 44px target on touch (mobile-nav.css).
    toast: {
      slots: {
        root: 'shadow-(--shadow-overlay)',
        actions: 'kando-toast-actions'
      }
    },
    dropdownMenu: {
      slots: {
        content: `z-(--z-popover) min-w-40 rounded-lg shadow-(--shadow-overlay) ${MENU_MOTION}`,
        // A row is 32 px (`min-h-8`) whether or not it carries a 20 px icon: its height is explicit, not the 1.3 text line plus padding (kd#190).
        // Below `md` it is at least 44 px (a floor: description rows reach 48 px), the phone floor of every control (DESIGN.md "Space, size and shape", #336); `max-md:items-center` keeps label, icon and check on the row's middle in the taller row (Nuxt UI's `items-start` leaves them at the top); from `md` up the row is as tall as its content
        item: 'min-h-8 max-md:min-h-11 max-md:items-center text-sm cursor-pointer'
      }
    },
    collapsible: {
      slots: {
        root: '',
        content: 'data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up overflow-hidden'
      }
    },
    // Fields (DESIGN.md "Space, size and shape", kd#178): one size, `lg`, as the theme default, so no call site sets
    // `size`; the height is the `--field-h` token (36 px, 44 px on a phone), explicit and not the text
    // line plus padding (slice 1b, kd#190, changes that line). The one exception is the task sheet's title field,
    // which keeps `xl` and its own height. The one disabled look (DESIGN.md "States"): 50 % opacity and
    // `not-allowed`, on fields as on buttons; a field that loads also sets `disabled`, which locks it like a loading
    // button (tests/config/field-size.test.ts). Placeholders step down through `text-muted`, not Nuxt UI's
    // `text-dimmed` (2.5:1 on the sheet; Receding Text Rule, #646).
    input: {
      slots: {
        base: [
          'h-(--field-h) placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50'
        ]
      },
      compoundVariants: [
        // The task sheet's title keeps its own taller line (`h-auto`), never below the field height: on a phone that is the 44 px floor (#592)
        { size: 'xl', class: { base: 'h-auto min-h-(--field-h)' } }
      ],
      defaultVariants: {
        size: 'lg'
      }
    },
    formField: {
      slots: {
        // Field error text: error-500 on the page ground is below AA (#353); error-700 meets it. The one error colour of a field (#72)
        error: 'text-error-700'
      }
    },
    select: {
      slots: {
        content: `rounded-lg shadow-(--shadow-overlay) ${MENU_MOTION}`,
        // The `lg` item (p-2, text-sm) is 16 + 18.2 = 34.2 px at 1.3; `min-h-9` keeps the 36 px row it had before kd#190.
        // Below `md` a row is at least 44 px, centred (the phone floor, #342)
        item: 'min-h-9 max-md:min-h-11 max-md:items-center',
        base: [
          'h-(--field-h) disabled:cursor-not-allowed disabled:opacity-50'
        ]
      },
      defaultVariants: {
        size: 'lg'
      }
    },
    selectMenu: {
      slots: {
        base: 'h-(--field-h) disabled:opacity-50',
        // The picker's rows keep the `md` item (p-1.5, text-sm) that TaskPropertySelect documents; `lg` would add 2 px.
        // Below `md` a row is at least 44 px, centred (the phone floor, #342)
        item: 'min-h-8 max-md:min-h-11 max-md:items-center p-1.5',
        content: `z-(--z-popover) min-w-40 rounded-lg shadow-(--shadow-overlay) ${MENU_MOTION}`
      },
      variants: {
        // `soft` is the select of the task sheet's property rows (#114, DESIGN.md "Components"):
        // a muted fill and a chevron at rest, no border, so a value that opens a list reads as one. One field height
        // like every field (`--field-h`). Wrapped by TaskPropertySelect; set it nowhere else.
        // `property` (#161) is the quiet text trigger, kept for the add sheet's footer line (AddTargetSwitch):
        // body text with the dotted rule on hover/focus (task-detail.css), no fill, no caret, no icons.
        variant: {
          soft: 'text-default bg-muted hover:bg-(--ui-border-accented) focus:bg-muted focus-visible:bg-(--ui-border-accented) disabled:bg-muted disabled:hover:bg-muted',
          property: {
            value: 'pointer-events-none',
            placeholder: 'text-muted',
            leading: 'hidden',
            trailing: 'hidden'
          }
        }
      },
      // Compound variants merge after the size classes, so these win over `size`.
      compoundVariants: [
        {
          variant: 'soft',
          class: {
            base: 'w-48 cursor-pointer text-sm',
            placeholder: 'text-muted',
            trailingIcon: 'size-4 text-muted'
          }
        },
        {
          variant: 'property',
          class: {
            base: 'task-property-value -ms-2 cursor-pointer rounded-sm px-2 py-0 text-sm text-default'
          }
        }
      ],
      defaultVariants: {
        size: 'lg'
      }
    },
    textarea: {
      slots: {
        base: [
          'min-h-(--field-h) placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50'
        ]
      },
      defaultVariants: {
        size: 'lg'
      }
    },
    // The button ladder (kd#177, #424, DESIGN.md "The One Height Rule"): one height and four looks. `md` is the default, 36 px
    // (48 on a phone): every button, also the rows' and cards' actions, has the height of the main action; `lg` is the same line
    // for the Nuxt UI components that pass a size down, no call site names it. The height is written here (`md:h-9`), not derived
    // from the text line plus padding, so a change of the interface line height cannot move it. A solid primary or error button is
    // also at least 96 px wide (`min-w-24`), so a short label ("Weiter") keeps the wide rectangle. A button that stays smaller is a
    // listed exception with a reason (tests/config/button-ladder.test.ts `SMALLER_BY_DESIGN`). Looks: solid (the one main action), soft (a neutral action that stands on its own, and the one
    // main action of a row), ghost (every further action in a row, card, menu or toolbar, every icon-only button), link.
    // `sm`, `xl`, `outline` and `subtle` are Nuxt UI's and stay in the merged theme (a theme cannot delete a key) but are
    // unused: tests/config/button-ladder.test.ts fails on them, the `/ui` entry leaves them out (`only`). `xs` is 24 px and exists only for the
    // actions Nuxt UI renders in an alert or toast (`size="xs"`, no template sets it); it takes the 14 px text step of the
    // notice beside it, not Nuxt UI's 12 px (#377); those actions keep their own 44 px phone rule (`.kando-notice-actions`, `.kando-toast-actions` in mobile-nav.css, #284).
    // On a phone every labelled button is 48 px high, icon-only ones 44 x 44 (the heights above apply from `md` up, so a label that wraps grows the button on a phone),
    // so no surface applies `.touch-target` by hand. Nuxt UI internals follow the floor, measured at 390 px (#552):
    // calendar header and its Löschen / Heute 44, modal close 44 x 44. The ladder covers buttons only: `USelect` and
    // `UInput` keep their own field heights.
    button: {
      defaultVariants: {
        size: 'md'
      },
      slots: {
        // The state language (DESIGN.md "States"): the one disabled look here; the hand cursor, the press and the
        // fast transition come from the base layer (assets/css/main.css) for every pressable element.
        // `data-heading-toggle` (#630): the toggle inside a section heading reads as the heading's 12 px label, not as a button label
        base: 'group/btn max-md:min-h-11 disabled:opacity-50 aria-disabled:opacity-50 data-[heading-toggle]:text-xs data-[heading-toggle]:font-medium data-[heading-toggle]:text-muted data-[heading-toggle]:hover:text-muted',
        // A trailing caret turns while the button controls an open popup (`aria-expanded`), the way the select's caret does; the
        // button names its own group, so a button inside another group is not read by that one
        trailingIcon: 'transition-transform duration-(--duration-base) group-aria-expanded/btn:rotate-180'
      },
      variants: {
        size: {
          xs: { base: 'md:h-6 py-0.5 text-sm' },
          // One height for every button, the primary's (#424, DESIGN.md "The One Height Rule"): 36 px, 48 px on a phone.
          // `lg` is the same line: Nuxt UI components that pass a size down still land on it, no call site names it.
          md: { base: 'md:h-9 max-md:min-h-12 px-3 text-sm' },
          lg: { base: 'md:h-9 max-md:min-h-12 px-3 text-sm' }
        }
      },
      compoundVariants: [
        // Neutral soft: a fill one step darker than whatever lies below, so it shows on a white sheet and on the
        // paper (Nuxt UI's `bg-elevated` is white here). Neutral ghost gains the same fill on hover.
        {
          color: 'neutral',
          variant: 'soft',
          class: 'bg-(--fill-on-canvas) hover:bg-(--fill-on-canvas-hover) active:bg-(--fill-on-canvas-hover) disabled:bg-(--fill-on-canvas) aria-disabled:bg-(--fill-on-canvas)'
        },
        {
          color: 'neutral',
          variant: 'ghost',
          class: 'hover:bg-(--fill-on-canvas) active:bg-(--fill-on-canvas-hover)'
        },
        // A solid primary or error button keeps the wide rectangle even with a short label ("Weiter", "OK"): 96 px (#424)
        { color: ['primary', 'error'], variant: 'solid', square: false, class: 'min-w-24 justify-center' },
        // `xs` is the action of an alert or toast: no floor here, the notice's own 44 px rule applies on a phone
        { size: 'xs', class: 'max-md:min-h-0' },
        // Icon-only buttons: 44 x 44 on a phone, 36 x 36 on desktop (the one height), the icon centred
        { square: true, class: 'max-md:min-h-11 max-md:min-w-11 max-md:justify-center md:min-w-9' },
        // The round icon button (#602, source-2): one look for the circle that sits on the paper or a card's edge. A call site
        // opts in with `data-round` (geometry and the phone rule) and, off the canvas fill, `data-fill`; it keeps only its
        // placement (position, opacity, z-index). Unlayered host CSS still wins over these utilities, so a host that restates
        // a size or fill keeps its own: delete the restatement.
        //   data-round="md"    32 px; 44 px on a phone (the button ladder's floor)       (column add, stack close)
        //   data-round="sm"    28 px at every width, a 44 px hit area around it           (card menu, focus bar's end)
        //   data-round="arrow" 32 px, 28 px on a phone, the same 44 px hit area           (the plan arrows of "Alle")
        //   data-round="bar"   the app bar pill's height (--app-nav-pill-height); 44 px round on a phone, never shrinks (the funnel)
        //   data-fill="primary" opaque forest 100 with forest 600 (readable over a card's edge); data-fill="none" no fill at rest, the primary wash on hover; data-fill="quiet" no fill, muted glyph, canvas fill on hover
        {
          square: true,
          class: [
            'data-[round]:relative data-[round]:p-0 data-[round]:justify-center data-[round]:rounded-full data-[round]:cursor-pointer',
            'data-[round]:bg-(--fill-on-canvas) data-[round]:text-default data-[round]:hover:not-disabled:bg-(--fill-on-canvas-hover) data-[round]:active:not-disabled:bg-(--fill-on-canvas-hover)',
            'data-[round=md]:size-8 data-[round=md]:min-w-8 max-md:data-[round=md]:size-11 max-md:data-[round=md]:min-w-11 max-md:data-[round=md]:min-h-11',
            'data-[round=sm]:size-7 data-[round=sm]:min-w-7 max-md:data-[round=sm]:min-w-7 max-md:data-[round=sm]:min-h-0',
            'data-[round=arrow]:size-8 data-[round=arrow]:min-w-8 max-md:data-[round=arrow]:size-7 max-md:data-[round=arrow]:min-w-7 max-md:data-[round=arrow]:min-h-0',
            'data-[round=bar]:size-(--app-nav-pill-height) data-[round=bar]:min-w-(--app-nav-pill-height) data-[round=bar]:shrink-0 max-md:data-[round=bar]:size-11 max-md:data-[round=bar]:min-w-11 max-md:data-[round=bar]:min-h-11',
            'data-[round=sm]:after:absolute data-[round=sm]:after:-inset-2 data-[round=sm]:after:content-[\'\']',
            'max-md:data-[round=arrow]:after:absolute max-md:data-[round=arrow]:after:-inset-2 max-md:data-[round=arrow]:after:content-[\'\']',
            '[&[data-round][data-fill=primary]]:bg-primary-100 [&[data-round][data-fill=primary]]:text-primary-600 [&[data-round][data-fill=primary]]:hover:not-disabled:bg-primary-200 [&[data-round][data-fill=primary]]:active:not-disabled:bg-primary-200',
            '[&[data-round][data-fill=quiet]]:bg-transparent [&[data-round][data-fill=quiet]]:text-muted [&[data-round][data-fill=quiet]]:hover:not-disabled:text-highlighted',
            '[&[data-round][data-fill=none]]:bg-transparent [&[data-round][data-fill=none]]:text-primary [&[data-round][data-fill=none]]:hover:not-disabled:bg-(--primary-wash-hover) [&[data-round][data-fill=none]]:active:not-disabled:bg-(--primary-wash-hover)'
          ].join(' ')
        },
        {
          color: 'primary',
          variant: 'solid',
          // Primary 600 on hover/press: the base primary/75 blend measures 3.33:1 with white text (#251); enabled: keeps disabled states flat
          class: 'enabled:hover:bg-primary-600 enabled:active:bg-primary-600'
        },
        // Soft primary: the 600 step as text on the primary wash; the guard (button-contrast.test.ts) keeps it at 4.5:1 (#152)
        {
          color: 'primary',
          variant: 'soft',
          class: 'text-primary-600'
        },
        // Same for error: the base raspberry-500 text on its 10% tint measures ~4.0:1 (#594); the 700 step is 6.2:1 on the tint
        {
          color: 'error',
          variant: 'soft',
          class: 'text-error-700'
        },
        // Subtle primary: the same 600 step as soft (#97). No call site uses it (kd#177); Nuxt UI's own components still
        // reach it, so it keeps its contrast.
        {
          color: 'primary',
          variant: 'subtle',
          class: 'text-primary-600'
        },
        // Hover and press of the primary text variants (kd#124): the 500 step on its own 10% hover wash is too close to
        // 4.5:1 on the paper, and the link fades to 75%. The 600 step on hover and press, the rest state stays.
        ...(['outline', 'ghost', 'link'] as const).map((variant) => ({
          color: 'primary' as const,
          variant,
          class: 'hover:text-primary-600 active:text-primary-600'
        })),
        // The base error and neutral solid fades to 75% on hover (3.3:1 and 3.9:1 with white text, #97): deepen it like the primary instead
        {
          color: 'error',
          variant: 'solid',
          class: 'enabled:hover:bg-error-600 enabled:active:bg-error-600'
        },
        {
          color: 'neutral',
          variant: 'solid',
          class: 'enabled:hover:bg-neutral-600 enabled:active:bg-neutral-600'
        },
        ...buttonRoleCompounds
      ]
    },
    // A link inside a sentence (#603): the look of the `text-link` utility (assets/css/utilities.css, which `ExternalLink`
    // uses), spelled in classes here because the theme's own `text-muted` and `hover:text-default` have to be merged away
    // (a custom utility is invisible to tailwind-merge). No call site sets its own colour or underline; the active state
    // carries no second colour.
    link: {
      base: 'rounded-sm underline underline-offset-2 focus-ring',
      variants: {
        active: { true: 'text-primary-600', false: 'text-primary-600' }
      },
      compoundVariants: [
        { active: false, disabled: false, class: 'hover:text-primary-700' }
      ]
    },
    // One in-page tab look (#557): a track on the canvas, the active tab a flat white chip (a selected tab is a fill,
    // never a shadow: DESIGN.md "States"). Nuxt UI's neutral pill fills the active tab with `bg-inverted`; the second class on the
    // `before:` selector covers a list without an indicator. Unselected text stays `text-muted` from the base slot.
    tabs: {
      slots: {
        // Phone: every tab is a 44px target (DESIGN.md "Space, size and shape"), like the button floor above; no call site sets it
        trigger: 'max-md:min-h-11 max-md:min-w-11 disabled:opacity-50'
      },
      // A tab is 32 px (24, 28 and 36 for the sizes no template uses; `xl` is the 44 px page navigation) whatever the text line is: the height is explicit,
      // never the 1.3 line of the interface role plus padding (kd#190; DESIGN.md "Space, size and shape")
      variants: {
        size: {
          xs: { trigger: 'h-6' },
          sm: { trigger: 'h-7' },
          md: { trigger: 'h-8' },
          lg: { trigger: 'h-9' },
          // The navigation of a page (Einstellungen, #333): 16 px labels, 44 px at every width
          xl: { trigger: 'h-11' }
        }
      },
      compoundVariants: [
        // ...and its underline is 2 px, so the strip reads as the page's navigation, not as a detail
        { orientation: 'horizontal', variant: 'link', size: 'xl', class: { indicator: 'h-0.5' } },
        // A list that scrolls sideways (`overflow-x-auto`) clips at its padding box, so the 1px underline that sits in the border (`-bottom-px`) would vanish: draw it just above the border instead (#368)
        { orientation: 'horizontal', variant: 'link', class: { indicator: 'in-[.overflow-x-auto]:bottom-0' } },
        {
          color: 'neutral',
          variant: 'pill',
          class: {
            list: 'bg-(--fill-on-canvas)',
            indicator: 'bg-default shadow-none',
            trigger: [
              'data-[state=active]:text-highlighted',
              'in-[[data-slot=list]:not(:has([data-slot=indicator]))]:data-[state=active]:before:bg-default'
            ]
          }
        }
      ],
      defaultVariants: {
        color: 'neutral'
      }
    },
    alert: {
      slots: {
        // Full-strength description: Nuxt UI's `opacity-90` takes every role's text below AA on its own wash (#353, kd#123)
        description: 'text-body opacity-100'
      },
      variants: {
        // The flat note (DESIGN.md "Tell the user something": one quiet line above the content): the subtle alert without its ring,
        // a line high instead of a box, the title in the text colour. Trash note, data storage notice. It stays off a sheet that
        // already is the box (`DataResetSection` keeps icon and text, no card in a card).
        variant: { flat: { root: 'py-3', title: 'text-default' } }
      },
      // Role text on the role's wash: the default 500 step measures 1.8 to 4.1:1 (#353, #368, #74, kd#123)
      compoundVariants: [...alertRoleCompounds, ...alertFlatCompounds]
    },
    // The app bar's problem dot is the one chip: the fill takes the 700 step, the 500 one is below 3:1 (WCAG 1.4.11), like the solid badge
    chip: {
      variants: { color: { ...ROLE_FILL, error: 'bg-error-700' } }
    },
    // The palette (Variant B "Quiet Desk", chosen over stock A and dense C): group labels in the sans at 500 (The One Role Rule), no
    // hard dividers between groups, suffix in Graphite (`text-muted`) for AA contrast. The slots sit in a compound variant, not in
    // `slots`: Nuxt UI's `size` and `virtualize` variants come after the slots and would win the merge (`text-xs`, `divide-y`).
    commandPalette: {
      compoundVariants: [
        {
          size: 'md',
          class: {
            root: 'divide-default/40',
            footer: 'mt-auto', // the keys hint stays at the bottom of the fixed-height panel, whatever the list holds (#601)
            viewport: 'divide-y-0 p-2 mask-b-from-92%',
            group: 'p-0 pb-3',
            label: 'text-xs font-medium text-muted px-3 pt-3 pb-1',
            // The stock highlight (bg-elevated/50) is invisible on the bg-elevated (white) modal, and so is bg-muted (~1.07:1); use the
            // canvas fill's hover step, the same warm tint as every other state fill (main.css `--fill-on-canvas-hover`).
            // Disabled rows keep full opacity so the reason suffix stays AA; only the label is dimmed.
            // 36 px from md up, at least 44 px below it (DESIGN.md "Control height", #345), content on the row's middle there.
            item: 'min-h-9 max-md:min-h-11 max-md:items-center px-3 py-2 text-sm before:rounded-lg data-disabled:opacity-100 data-highlighted:not-data-disabled:before:bg-(--fill-on-canvas-hover)',
            itemLabelBase: 'group-data-disabled:text-dimmed',
            itemLeadingIcon: 'group-data-disabled:text-dimmed',
            itemLabelSuffix: 'text-muted'
          }
        }
      ]
    },
    // A group's legend is the 14 px medium label in the highlighted text colour (the one radio group is the data folder choice)
    radioGroup: {
      slots: { legend: 'text-sm font-medium text-highlighted' }
    },
    badge: {
      variants: {
        size: {
          // One badge size (kd#180): `md`, the default, at the 12 px label step, 20 px high. rem instead of Nuxt UI's px chip sizes so chips follow text zoom (WCAG 1.4.4, #66).
          // The theme cannot delete Nuxt UI's `xs`, `sm`, `lg` and `xl`; no template sets them and the `/ui` matrix leaves them out.
          md: { base: 'text-xs/3 px-1.5 py-1 rounded-sm' }
        }
      },
      compoundVariants: [
        {
          color: 'neutral',
          variant: 'soft',
          class: 'text-default bg-accented'
        },
        ...badgeRoleCompounds
      ]
    },
    // Phone: the whole row of a checkbox is the target (#592). The box is 16 px, so its row is 44 px high and an invisible layer
    // over the row (the box's `::after`, positioned against the row) takes the tap, label and gap included.
    // A ticked checkbox is the primary fill everywhere (DESIGN.md "States", #606): the colour is set here once, no call site sets one
    checkbox: {
      defaultVariants: {
        color: 'primary'
      },
      slots: {
        root: 'max-md:min-h-11 max-md:items-center',
        base: 'max-md:after:absolute max-md:after:inset-0'
      }
    },
    // Off state of a switch (#683): the stock soft-grey track (neutral-200) is 1.1:1 on the page wash, under the 3:1 of WCAG 1.4.11.
    // An outlined white track with a muted-ink thumb (--ui-text-muted, 5.5:1 on the page wash) reads as off; on stays the filled primary track.
    switch: {
      slots: {
        // On a phone the 32.8 x 16.8 track gets an invisible 44 px hit area (6 px to the sides, inside the 12 px gap a field leaves; 16 px above and below): every switch, no call site repeats it (#592)
        base: 'relative max-md:after:absolute max-md:after:-inset-x-1.5 max-md:after:-inset-y-4 data-[state=unchecked]:bg-default data-[state=unchecked]:border-(--ui-text-muted)',
        thumb: 'shadow-none data-[state=unchecked]:bg-(--ui-text-muted)'
      }
    },
    // Hover of a selectable table row (#598): the stock `bg-elevated/50` is white on a white sheet and shows nothing; the list row's
    // muted tint (DESIGN.md "Show a list row", `ListRow`) instead.
    table: {
      slots: {
        tbody: '[&>tr]:data-[selectable=true]:hover:bg-muted'
      }
    },
    card: {
      variants: {
        variant: {
          task: {
            root: 'bg-elevated',
            // Every `sm:` value stays written out: Nuxt UI's default body is `p-4 sm:p-6`, and a missing `sm:px-3` brings its 24 px back (kd#181)
            body: 'px-3 pt-2 pb-1 sm:px-3 sm:pt-3 sm:pb-1',
            footer: 'px-3 pt-1 pb-2 sm:px-3 sm:pt-2 sm:pb-3',
          }
        }
      }
    }
  },
  featureFlags: {
    notionDataSourceSelection: false,
    openColumnAddButton: true,
  },
})