import { driver, type Driver } from "driver.js";
import { ACTIVE_DATASET } from "../datasets/active";
import { sendScrollIntoView } from "./post-message";

/**
 * The query the live demo runs — set per catalog in the dataset config,
 * chosen so the top result shows both an exact match and a synonym/concept
 * match, demonstrating both highlight colors.
 */
export const DEMO_QUERY = ACTIVE_DATASET.demoQuery;

export interface TourActions {
  /** Fills the search box with {@link DEMO_QUERY} and runs it for real. */
  runDemoSearch: () => Promise<void>;
  /** Opens the AI side's top result from the just-run demo search. */
  openFirstResult: () => void;
  /** Closes the modal and restores the default comparison, however the tour ends. */
  reset: () => void;
  /**
   * The filters {@link DEMO_QUERY} sets by itself, ready to read
   * ('category "Skin Care", max price $25'); null when it sets none — then
   * the tour skips the step that points them out.
   */
  demoFilters: string | null;
}

/**
 * Waits until `selector` matches an element that has actually been laid
 * out (non-zero size), polling via requestAnimationFrame so the check
 * runs after layout/paint rather than racing it. Needed because the demo
 * steps target elements (a product card, the modal) that only exist once
 * a previous step's action has rendered them — driver.js's own
 * `waitForElement` uses a MutationObserver, which can fire the instant an
 * element is inserted but before the browser has laid it out, leaving its
 * bounding rect at zero and the popover pinned to the top-left corner.
 */
function waitForLaidOutElement(selector: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    function check() {
      const el = document.querySelector(selector);
      const rect = el?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        resolve();
        return;
      }
      if (performance.now() - start > timeoutMs) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  });
}

/**
 * Builds the guided tour: the first three steps introduce the static UI,
 * the rest actually run the demo search, walk through the keyword-vs-AI
 * comparison and open the AI's top result, so the comparison and the
 * highlighted-match colors are demonstrated rather than just described.
 */
export function createTour(actions: TourActions): Driver {
  return driver({
    showProgress: true,
    animate: true,
    overlayColor: "#000",
    overlayOpacity: 0.7,
    popoverClass: "leobit-driver-theme",
    // Not skipMissingElement: with it on, driver.js pre-checks whether the
    // *next* step's target already exists to decide whether to label the
    // button "Next" or "Done" — but step 6's target (the modal) is only
    // created by step 5's own action, so it would always look "missing"
    // one step early and mislabel the button "Done" on step 5.
    onDestroyStarted: (_element, _step, opts) => {
      actions.reset();
      opts.driver.destroy();
    },
    // Reported so a host embedding this app in an <iframe> can scroll its
    // own page to bring the highlighted region into view — driver.js can
    // only scroll within this document, which the host may have sized to
    // fit content exactly, leaving no scrollable overflow of its own.
    onHighlightStarted: (element) => {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      sendScrollIntoView(rect.top + window.scrollY, rect.height);
    },
    steps: [
      {
        element: '[data-tour="search-form"]',
        popover: {
          title: "Search with AI",
          description:
            "Type what you're looking for in plain language — the product, what it's for, who it's for — or pick one of the ready-made examples below the search bar.",
        },
      },
      {
        element: '[data-tour="mic-button"]',
        popover: {
          title: "Or just speak",
          description: "No typing needed — click the mic and describe what you need out loud.",
        },
      },
      {
        element: '[data-tour="filters-bar"]',
        popover: {
          title: "Fine-tune with filters",
          description:
            "Narrow the catalog by category, item form, rating, or price — or just say it in your query. Filters apply to both searches.",
        },
      },
      {
        element: '[data-tour="search-form"]',
        popover: {
          title: "Let's try it",
          description: `Click "Next" and we'll search for "${DEMO_QUERY}" for you.`,
          onNextClick: async (_element, _step, opts) => {
            await actions.runDemoSearch();
            await waitForLaidOutElement('[data-tour="first-ai-result"]');
            opts.driver.moveNext();
          },
        },
      },
      ...(actions.demoFilters
        ? [
            {
              element: '[data-tour="filters-bar"]',
              popover: {
                title: "Filters from your words",
                description: `AI read the query too and set the filters for you: ${actions.demoFilters} — each tagged "from your query". Change or clear them any time.`,
              },
            },
          ]
        : []),
      {
        element: '[data-tour="comparison"]',
        waitForElement: 2000,
        popover: {
          title: "Keyword search vs AI search",
          description:
            'The same query, run two ways. Left: plain keyword search, the way most stores search. Right: AI search. "Found only by AI" marks products keyword search missed, "Filtered out by AI" fades the keyword results AI left out, and arrows show how AI re-ranked the rest.',
        },
      },
      {
        element: '[data-tour="first-ai-result"]',
        waitForElement: 2000,
        popover: {
          title: "AI's top pick",
          description: 'Click "Next" to open it and see why it matched.',
          onNextClick: async (_element, _step, opts) => {
            actions.openFirstResult();
            await waitForLaidOutElement('[data-tour="product-modal"]');
            opts.driver.moveNext();
          },
        },
      },
      {
        element: '[data-tour="product-modal"]',
        waitForElement: 2000,
        popover: {
          title: "Highlighted matches",
          description:
            "Exact query words are highlighted in yellow, similar or synonym terms in green — so you can see exactly why a product matched.",
        },
      },
    ],
  });
}
