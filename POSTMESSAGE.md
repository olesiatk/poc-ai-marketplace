# postMessage bridge

How this app talks to a host page that embeds it in an `<iframe>`. It is a subset of the shared
Leobit PoC postMessage contract, covering only the messages this app's features need.

All of it lives in one module, [`src/app/lib/post-message.ts`](src/app/lib/post-message.ts). Nothing
else in the app calls `window.parent.postMessage` or listens to raw `message` events. Every function
does nothing when the app isn't embedded (`isEmbedded()`: `window.parent !== window`), so standalone
and dev use are unaffected.

Every message that crosses the boundary, in either direction, is logged to the console as
`REMOTE: type: <type>`, so you can check the bridge from devtools alone.

## Messages

| Direction | `type` | Parameters | Sent / handled in |
|---|---|---|---|
| frame → host | `poc-frame-ready` | — | `App` constructor, before the first height report |
| frame → host | `poc-resize-iframe` | `height: number` (px, rounded up) | [`lib/iframe-resize.ts`](src/app/lib/iframe-resize.ts) |
| frame → host | `poc-tour-status` | `active: boolean` | `App` (tour start / `resetTourDemo()`) |
| frame → host | `poc-modal` | `open: boolean`, `minHeight?: number` | `ProductModalComponent` mount / unmount |
| frame → host | `poc-scroll-into-view` | `top`, `height`, `block`, `padding?` | [`lib/tour.ts`](src/app/lib/tour.ts) on each step, and `ProductModalComponent` on open (see below) |
| host → frame | `poc-host-ready` | — | logged only, nothing depends on it |
| host → frame | `ask-for-height` | — | `App` replies with an immediate `poc-resize-iframe` |
| host → frame | `poc-dismiss` | — | `App` (ends the tour) and `ProductModalComponent` (closes itself) |

Inbound messages are accepted only from `window.parent` (`event.source`) and only if their type is on
an explicit allow-list. The list isn't a `poc-` prefix check, because `ask-for-height` has no prefix.

### `poc-resize-iframe`

The app measures its own root element (`App`'s host), not `document.documentElement.scrollHeight`,
which can get stuck at the tallest height the page ever reached. It sends one report on init and more
from a `ResizeObserver` on the root, on window resize, on `ask-for-height`, and right after the
product modal closes.

The report after the modal closes is forced (`reportIframeHeightNow()`). While the modal is open, the
host grows the iframe to the modal's `minHeight`. The modal is `position: fixed`, so closing it doesn't
change the root's height and the `ResizeObserver` stays silent. Without the forced report, the iframe
would stay at the modal's height.

When embedded, the root isn't `min-h-screen` (`100vh`). Inside an iframe, `100vh` is the iframe's own
height, which the host sets from our report, so the two would feed each other.

### `poc-modal`

The product details modal is drawn by the app itself, inside the iframe. It stays in-frame rather than
moving to a host modal (`poc-open-media` / `poc-open-message`) because its content is too structured
for a text or media payload: photos, details, highlighted reviews.

The modal box is sized in `vh` (`max-h-[88vh]`), so `open: true` carries `minHeight: 640`. Without it,
a host that shrank the iframe to fit short content would clip the modal.

### `poc-scroll-into-view`

- **Tour steps.** Sent from driver.js's `onHighlightStarted`. driver.js can only scroll inside the
  iframe, which has no overflow of its own when the host sizes it to the content.
- **Product modal (deliberate deviation).** The contract reserves this message for tour steps. This app
  also sends it once when the product modal opens (`ngAfterViewInit`). The modal is
  `position: fixed`, so it's anchored to the iframe's own viewport. In a tall iframe on a host page
  scrolled elsewhere, it would open partly or fully off the visible screen.

### `poc-dismiss` (deliberate deviation)

The contract has the frame decide which overlay a dismiss closes: the modal if one is open,
otherwise the tour. Here the tour (in `App`) and the modal (`ProductModalComponent`) each subscribe on
their own and both react. On the tour's step that has the modal open, one click on the host's dim (or
Escape on the host page) closes the modal *and* ends the tour. This matches what a native Escape
inside the frame already does when both are open, so a dismiss behaves the same wherever it lands.

Ending the tour from here calls `driver.destroy()` directly, which bypasses driver.js's
`onDestroyStarted`. So `App` runs `resetTourDemo()` first: it clears the demo query, closes the
modal and sends `poc-tour-status { active: false }`.

## Deliberately left out

- `poc-open-media`: the app has no files (PDF, video, uploads) to preview full-screen.
- `poc-open-message`, `poc-modal-action`, `poc-modal-closed`: there are no confirmations or
  destructive actions, and no host-drawn dialogs, so nothing would send or receive them.
- `poc-routing`: there is no client-side routing.

## Before production

Outbound messages are posted with target origin `'*'`, since the host origin isn't known yet. Before
shipping, pin it to the real host origin and have the host check `event.origin`.
