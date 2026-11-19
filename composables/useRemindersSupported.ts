/**
 * @composable useRemindersSupported
 * @description Whether Apple Reminders can be set up on this device (#552): the Mac app, and the bridge does not answer
 * `unsupported` (`remindersSupported` in `lib/reminders.ts`). A ref that is `false` until the probe has answered (the web
 * build never changes it), so the welcome checkbox and the sources tab row start disabled and enable themselves on a Mac.
 * @responsibility
 * - Probes once per session (`reminders_access_status`: no prompt, no data read) and never throws
 */
import { getCurrentInstance, onMounted, ref, type Ref } from 'vue'
import { remindersSupported } from '~/lib/reminders'

export function useRemindersSupported(): Ref<boolean> {
  const supported = ref(false)
  const probe = () => {
    void remindersSupported().then((value) => { supported.value = value }, () => { supported.value = false })
  }
  if (getCurrentInstance()) onMounted(probe)
  else probe()
  return supported
}
