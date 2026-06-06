// Plugin code uses `window.setTimeout`/`clearTimeout`/`setInterval` for popout
// window compatibility (required by the Obsidian review). The test runner uses
// the Node environment, which has no `window`, so alias it to globalThis where
// the Node timer globals live.
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as { window?: unknown }).window = globalThis;
}
