# HTML to Design

Turn static HTML into editable Figma frames. This plugin parses computed styles (with an optional Playwright-powered capture server) and reconstructs the layout, typography, and assets inside auto-layout-friendly Figma frames, text nodes, and fills.

## Features

- Computes styles through either the built-in iframe parser or the `server/capture.js` capture server so fonts, shadows, gradients, and images feel accurate in Figma.
- Converts headings, buttons, lists, images, and SVGs into properly sized and styled Figma nodes while preserving margins, padding, and auto-layout alignment.
- Embeds remote assets as data URIs so imported layers keep their textures even if the source URLs disappear.
- Warns about missing fonts and applies documented fallbacks (Inter, Arial, Georgia, etc.).
- Supports prototype links when anchors point to `#ids` and emits local color/text styles once the import finishes.

## Getting started

### Prerequisites

- [Node.js 20+](https://nodejs.org) (includes `npm`).
- The [Figma desktop app](https://www.figma.com/downloads/) if you plan to load the plugin locally.

### Install dependencies

```bash
npm install
```

The `postinstall` hook automatically runs `playwright install chromium` so the capture server can render HTML/URLs reliably.

## Development workflow

| Task | Command | Purpose |
| ---- | ------- | ------- |
| Build everything | `npm run build` | Runs type checks, then bundles the main plugin worker and UI. |
| Watch for changes | `npm run watch` | Keeps `dist/code.js` and `dist/ui.js` in sync with edits. |
| Build main entry | `npm run build:main` | Rebuilds `code.ts` when you tweak plugin logic. |
| Build UI bundle | `npm run build:ui` | Refreshes `src/ui.ts` after UI or capture tweaks. |
| Type check | `npm run typecheck` | Validates the TypeScript project without emitting artifacts. |
| Lint | `npm run lint` | Runs ESLint (`npm run lint:fix` auto-fixes simple issues). |
| Clean output | `npm run clean` | Removes the `dist` directory so you can start fresh. |
| Capture server | `npm run serve:capture` | Starts `server/capture.js` (Playwright/Chromium) for more accurate computed styles. |

While `npm run watch` runs, Figma can reload your latest `dist` bundles as you edit files.

## Plugin usage

1. Build the plugin (`npm run build`) and point Figma to the `dist` directory via "Link existing plugin".
2. Paste your HTML into the UI, adjust the viewport, and toggle auto layout if desired.
3. Click **Import** to spawn a new frame inside Figma. The plugin loads fonts, applies fills, and resolves prototype links.
4. When the import finishes, the frame is selected and local color/text styles are created automatically.

The UI defaults to the iframe parser, but if the capture server is running, `src/ui.ts` will POST HTML to [http://localhost:3322/capture-html](http://localhost:3322/capture-html) to get Chromium-computed styles before sending the payload to `code.ts`.

## Capture server notes

- Starts on port `3322` and exposes `/capture` (from a URL) and `/capture-html` (raw HTML).
- Renders pages with Playwright/Chromium, waits for fonts and frameworks (Tailwind, etc.), then serializes the DOM with the same style keys the plugin expects.
- Useful when you need 1:1 fidelity for complex layouts or when fonts/styles behave differently inside a headless browser vs. the iframe fallback.

## Testing

```bash
npm test
```

Tests live in `__tests__` and exercise helpers that transform the captured JSON into Figma nodes.

## Tips

- Keep `npm run watch` running while developing so every save updates `dist` instantly.
- Use the browser console from the plugin UI (right-click in the plugin > Inspect UI) to debug DOM parsing.
- Install missing font families inside Figma or let the fallback map in `code.ts` keep things readable.
