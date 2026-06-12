# Team Lessons — Listing Elevate

Mistakes caught by the gates, recorded per run for future reference. Sorted newest first; keep only the 30 most recent.

## Lessons

**2026-06-11T23:32 (feat/auth-animation-fix):** Branch hygiene on shared checkout — Always cut feature branches from `origin/main` (fetch first, check merge-base), never from the current HEAD if it's on an unrelated feature branch. This run's worktree was set up cleanly from origin/main HEAD, avoiding the re-entrancy issue that would have caused a Prompt Lab merge into an operator-studio branch.

**2026-06-11T23:32 (feat/auth-animation-fix):** Animation synchronization — `autoFocus` on inputs fires *before* `setTimeout` and lifecycle effects, mid-animation. When a child element is focused synchronously during a parent's `framer-motion` y-translate, the browser's "scroll-to-focus" behavior competes with the transform, causing visible jank. Solution: remove autoFocus, defer `.focus()` via `useEffect(..., [ENTRY_MS])` timed to after the animation completes. Apply same pattern for any animation + autofocus interaction.

**2026-06-11T23:32 (feat/auth-animation-fix):** Conditional field mounting without transition — Wrapping a conditional form field (e.g., `{mode === "password" && <div>`) in nothing causes the mount/unmount to snap the card height instantly, destroying fluidity. Solution: wrap the conditional in `<AnimatePresence initial={false}>` + `<motion.div initial={opacity:0,height:0} animate={opacity:1,height:auto} exit={opacity:0,height:0}>` with a 220ms transition. Learned this run fixing the password field toggle.

**2026-06-11T23:32 (feat/auth-animation-fix):** State swap without transition — Ternary content swaps (e.g., `{sent ? <A /> : <B />}`) with no motion wrapper cause instant flips. Solution: wrap both branches in `<AnimatePresence mode="wait" initial={false}>` + `<motion.div key>` per branch (sent-state / form-state) with matching opacity/y transitions on enter/exit. The `mode="wait"` ensures exit completes before enter starts, preventing overlap.
