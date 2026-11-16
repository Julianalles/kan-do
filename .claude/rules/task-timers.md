---
paths:
  - "composables/useTaskTimerDriver.ts"
  - "lib/taskTimers.ts"
  - "store/tasks.ts"
  - "app.vue"
  - "composables/useWorkSessionTracking.ts"
  - "lib/liveTime.ts"
  - "tests/e2e/timer-lifecycle.spec.ts"
---
# Task timer rules (#352)

- **Task timers (#352):** a task in Jetzt is timed by `useTaskTimerDriver` (started once in `app.vue`; the status decides, no card and no page involved), intervals live only in `lib/taskTimers.ts`. `task.timerId` is a handle of this page load (reset at driver start, never passed to `clearInterval`); stop a timer through `stopTaskTimer(id)` (`clearInterval(task.timerId)` is an ESLint error). Time while the app is closed is not counted.
- **Checkpointed time (#286):** a tick writes no store: the second is collected in `lib/liveTime` (runtime-only, never persisted) and the driver writes it into `tasks-store` through `tasksStore.addTrackedSeconds` every `LIVE_CHECKPOINT_SECONDS` (10), in `stopTaskTimer`, driver `stop`, on `pagehide` and when the page turns hidden. What the user sees reads `liveTimeSpent(task)` (stored + collected: card chip, sheet, completion snapshot); code that needs the exact total of a task that may be in Jetzt either reads `liveTimeSpent` or runs after a stop. A checkpoint written while a push of the task is in flight bumps its pending-sync revision (`addTrackedSeconds`, only when a push or marker exists), so that push's echo cannot lower the total (`applySyncedTask` keeps the larger) and its landing keeps the queued entry (#313). A hard crash loses at most the 10 s collected. The user's time edit (`setTimeSpent`) discards the collected seconds.
- **Midnight (#356, the user's decision D2):** a tick knows its local day (`lastTickDay`, runtime). The first tick on a later day writes everything collected so far (the crossing second counts as before midnight; a held write is retried before anything else) and then calls `tasksStore.beginAfterMidnight(id, day)`; from there `addTrackedSeconds` adds to that one persisted note. Only the new day's pass reads it (`takeAfterMidnight`) and removes nothing: for the task still in Jetzt, for the day of the pass, it turns the count into a question in `day-recap-store.timeOffer` (at least a minute), and only the user's "Zeit abziehen" lowers the time (`takeOffSeconds`, through `setTimeSpent`, so a source that stores time gets the lower total, never below zero) and cuts the same spans out of the Statistik work sessions (the user's decision of 2026-11-16: nothing is removed silently). A task entering Jetzt (the watcher's arm), the user's time edit and every pass drop the note. Never compute "time after midnight" from the wall clock.
- **Work sessions (#600):** the driver tells `composables/useWorkSessionTracking` where it arms and stops a timer (`armJetztTask`, `stopTaskTimer`, driver `stop`); the session list grows by that module's own 60 s heartbeat. Never write a session from `tick`, `updateTaskTimespent` or `addTrackedSeconds`.
- **Pause (#383):** the floating Now window's pause is `stopTaskTimer(id)` and its resume `resumeTaskTimer(id)`; the task stays in Jetzt, "paused" is `task.timerId === null` there. Runtime-only: the driver's `start()` arms every Jetzt task, so a restart resumes timing. `composables/useNowWindowSync.ts` is the only caller.
