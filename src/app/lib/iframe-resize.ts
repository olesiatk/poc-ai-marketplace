import { sendResizeIframe } from "./post-message";

// The active watcher's reporter, so code that doesn't own the root element
// (the product modal) can force a report — see reportIframeHeightNow().
let activeReport: (() => void) | null = null;

/**
 * Reports this app's own content height to the host: once immediately,
 * then again on any layout change (ResizeObserver on `root`) and on
 * window resize. `reportNow` is also what the caller should invoke
 * whenever the host asks for an up-to-date height on demand.
 */
export function watchIframeHeight(root: HTMLElement): { reportNow: () => void; stop: () => void } {
  const reportNow = () => sendResizeIframe(root.getBoundingClientRect().height);

  const resizeObserver = new ResizeObserver(() => reportNow());
  resizeObserver.observe(root);
  window.addEventListener("resize", reportNow);
  activeReport = reportNow;
  reportNow();

  return {
    reportNow,
    stop: () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", reportNow);
      if (activeReport === reportNow) activeReport = null;
    },
  };
}

/**
 * Sends the current height even though nothing in the layout changed.
 * Needed right after `poc-modal { open: false }`: the host grew the iframe
 * to the modal's `minHeight`, but the modal is position: fixed, so closing
 * it doesn't change the root's height and the ResizeObserver stays silent —
 * without this the iframe would stay at the modal's height.
 */
export function reportIframeHeightNow(): void {
  activeReport?.();
}
