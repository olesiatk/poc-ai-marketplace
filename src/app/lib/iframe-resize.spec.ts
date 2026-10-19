import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportIframeHeightNow, watchIframeHeight } from "./iframe-resize";

describe("reportIframeHeightNow", () => {
  let postMessage: ReturnType<typeof vi.fn>;
  const originalParent = window.parent;

  beforeEach(() => {
    postMessage = vi.fn();
    Object.defineProperty(window, "parent", { value: { postMessage } as unknown as Window, configurable: true });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    Object.defineProperty(window, "parent", { value: originalParent, configurable: true });
    vi.unstubAllGlobals();
  });

  it("re-sends the watched root's height even when nothing changed", () => {
    const root = document.createElement("div");
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ height: 300 } as DOMRect);
    const watch = watchIframeHeight(root);
    postMessage.mockClear();

    reportIframeHeightNow();
    expect(postMessage).toHaveBeenCalledWith({ type: "poc-resize-iframe", height: 300 }, "*");

    watch.stop();
  });

  it("does nothing once the watcher is stopped", () => {
    const watch = watchIframeHeight(document.createElement("div"));
    watch.stop();
    postMessage.mockClear();

    reportIframeHeightNow();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
