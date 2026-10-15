/** How long after the page loads the deferred work runs if nobody has touched the page yet. */
const SETTLE_MS = 5000;

const FIRST_INPUT = ["pointerdown", "keydown", "touchstart"] as const;

/**
 * Runs `work` once, on the person's first tap, click, or key press, or a few seconds after the page
 * loaded, whichever is first. For code to fetch ahead of need (dialogs, the error screen) without
 * competing with the first screen's own requests. Returns a function that cancels it.
 */
export const whenSettled = (work: () => void): (() => void) => {
  let done = false;

  const cancel = () => {
    done = true;
    window.clearTimeout(timer);

    for (const type of FIRST_INPUT) window.removeEventListener(type, run, { capture: true });
  };

  const run = () => {
    if (done) return;

    cancel();
    work();
  };

  const timer = window.setTimeout(run, SETTLE_MS);

  for (const type of FIRST_INPUT) {
    window.addEventListener(type, run, { capture: true, passive: true });
  }

  return cancel;
};
