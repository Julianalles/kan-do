import { ref } from 'vue'
import type { TaskStatus } from '~/types/taskStatus'

/** A collapsed stack picked up as a whole (#150), as it was when the drag started */
export interface DraggedStack {
  /** Group key of the stack */
  key: string
  /** Readable group name, as in the caption */
  label: string
  /** Every member, in render order; the first is the front card and the sortable's id */
  taskIds: string[]
}

export interface DragState {
  isDragging: boolean
  /** The dragged card, or the front card of a dragged stack */
  draggedTaskId: string | null
  /** Set while a whole collapsed stack is dragged; null for a single card */
  draggedStack: DraggedStack | null
  /** TaskStatus of the column the dragged task originated from */
  sourceStatus: TaskStatus | null
  /** TaskStatus of the column currently being hovered over */
  hoverTargetStatus: TaskStatus | null
  /** True when drop is blocked by WIP limit (Progress column full) */
  isDropBlocked: boolean
  /**
   * The running Jetzt task a drop would swap out (#162): set while a single card from Offen or Wartet hovers
   * Jetzt and Jetzt holds exactly one task; that card shows the swap state. Cleared as soon as the hover
   * ends, and at the end of the drag.
   */
  swapTaskId: string | null
  /**
   * How many `ColumnDropZone` ghosts show right now (#285). `Board.vue` mirrors it as `data-drop-ghost` on `.board`, the
   * one hook `dnd.css` keys its empty-target rules on instead of `:has(.column-drop-zone__ghost)`, which put every
   * card in the `:has()` scope. A count, not a flag: when the pointer passes from one zone to the next, the order of
   * the leaving and the entering zone must not matter.
   */
  ghostCount: number
  /** The drag started on a card under "Meine Aufgaben" (#355); `sourceStatus` is null then */
  fromNotPlanned: boolean
  /** The "Meine Aufgaben" side is the drop target right now (#355): it shows its wash for a card from Offen, and the placeholder leaves Offen's layout */
  overNotPlanned: boolean
  /** After a drop, while the floating preview glides to its slot (kd#181, `useDropMotion`): the card it lands on */
  landingTaskId: string | null
  /** The stack the gliding preview shows; null for a single card */
  landingStack: DraggedStack | null
  /** The card that is being set down right after the glide; cleared after one animation */
  setDownTaskId: string | null
}

// Global drag state to allow communication between column instances
const dragState = ref<DragState>({
  isDragging: false,
  draggedTaskId: null,
  draggedStack: null,
  sourceStatus: null,
  hoverTargetStatus: null,
  isDropBlocked: false,
  swapTaskId: null,
  ghostCount: 0,
  fromNotPlanned: false,
  overNotPlanned: false,
  landingTaskId: null,
  landingStack: null,
  setDownTaskId: null,
})

export function useBoardDragState() {
  return {
    dragState
  }
}
