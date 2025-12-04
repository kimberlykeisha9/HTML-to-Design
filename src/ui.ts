// src/ui.ts — runs in the plugin iframe (browser)
export {};

type JsonNode =
  | { kind: 'text'; text: string }
  | {
      kind: 'element';
      tag: string;
      attrs: Record<string, string>;
      style: Record<string, string>;
      children: JsonNode[];
    };

type BackgroundMatch = { match: string; url: string };

type PluginOutboundMessage =
  | { type: 'error'; message: string }
  | {
      type: 'import-html';
      payload: JsonNode[];
      options: { autoLayout: boolean; createStyles: boolean; prototypeLinks: boolean; viewport: { width: number; height: number } };
    };

type PluginInboundMessage =
  | { type: 'done' }
  | { type: 'error'; message?: string }
  | { type: 'missing-fonts'; fonts?: { family: string; style: string }[] }
  | { type: 'font-substitutions'; items?: { original: string; fallback: string }[] };

const importBtn = document.getElementById('importBtn') as HTMLButtonElement | null;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement | null;
const htmlInput = document.getElementById('htmlInput') as HTMLTextAreaElement | null;
const autoLayoutCheckbox = document.getElementById('autoLayout') as HTMLInputElement | null;
const viewportWidthInput = document.getElementById('viewportWidth') as HTMLInputElement | null;
const viewportHeightInput = document.getElementById('viewportHeight') as HTMLInputElement | null;
const fontWarning = document.getElementById('fontWarning') as HTMLDivElement | null;

const parentOrigin = (() => {
  if (!document.referrer) return '*';
  try {
    return new URL(document.referrer).origin;
  } catch {
    return '*';
  }
})();

const FETCH_TIMEOUT = 5000;
const imageCache = new Map<string, Promise<string | null>>();
let fontMessages: string[] = [];

const STYLE_KEYS: string[] = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'border',
  'border-style',
  'border-color',
  'border-width',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'box-shadow',
  'display',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'row-gap',
  'column-gap',
  'opacity',
  'width',
  'height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'transform',
  'transform-origin',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'grid-gap',
  'grid-auto-flow',
];

const BACKGROUND_URL_PATTERN = /url\((['"]?)(.+?)\1\)/i;

function safePost(message: PluginOutboundMessage) {
  parent.postMessage({ pluginMessage: message }, parentOrigin);
}

function isTypedMessage(value: unknown): value is { type: string } {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function extractPluginMessage(data: unknown): PluginInboundMessage | null {
  if (isTypedMessage(data)) return data as PluginInboundMessage;
  if (typeof data === 'object' && data !== null) {
    const envelope = data as { pluginMessage?: unknown };
    if (isTypedMessage(envelope.pluginMessage)) return envelope.pluginMessage as PluginInboundMessage;
  }
  return null;
}

function clearFontMessages() {
  fontMessages = [];
  if (fontWarning) {
    fontWarning.textContent = '';
    fontWarning.style.display = 'none';
  }
}

function pushFontMessage(message: string) {
  if (!message) return;
  fontMessages.push(message);
  if (fontWarning) {
    fontWarning.textContent = fontMessages.join(' | ');
    fontWarning.style.display = 'block';
  }
}

function pickComputedStyle(win: Window, el: Element): Record<string, string> {
  const cs = win.getComputedStyle(el);
  const style: Record<string, string> = {};
  for (const key of STYLE_KEYS) {
    const value = cs.getPropertyValue(key);
    if (value) style[key] = value.trim();
  }
  return style;
}

function nodeToJsonComputed(win: Window, node: Node): JsonNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent || '').replaceAll(/\s+/g, ' ').trim();
    if (!text) return null;
    return { kind: 'text', text };
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (['script', 'style', 'link', 'meta', 'head'].includes(tag)) return null;
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) attrs[attr.name] = attr.value;
  const style = pickComputedStyle(win, el);
  const children: JsonNode[] = Array.from(el.childNodes)
    .map((child) => nodeToJsonComputed(win, child))
    .filter(Boolean) as JsonNode[];
  return { kind: 'element', tag, attrs, style, children };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
}

function isDataUrl(url?: string): boolean {
  return /^data:/i.test(url ?? '');
}

function extractBackgroundUrl(value?: string): BackgroundMatch | null {
  if (!value) return null;
  const match = BACKGROUND_URL_PATTERN.exec(value);
  if (!match) return null;
  const candidate = match[2].trim();
  if (!/^https?:/i.test(candidate) || isDataUrl(candidate)) return null;
  return { match: match[0], url: candidate };
}

function cachedFetchDataUrl(url: string): Promise<string | null> {
  if (imageCache.has(url)) return imageCache.get(url)!;
  const promise = (async () => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeoutId: number | undefined;
    try {
      if (controller) timeoutId = globalThis.setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      const response = await fetch(url, controller ? { signal: controller.signal, mode: 'cors' } : { mode: 'cors' });
      if (timeoutId) globalThis.clearTimeout(timeoutId);
      if (!response?.ok) throw new Error(`status ${response?.status ?? 'unknown'}`);
      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
      const buffer = await response.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      console.warn('Failed to fetch asset', url, error);
      return null;
    }
  })();
  imageCache.set(url, promise);
  return promise;
}

async function embedExternalAssets(nodes: JsonNode[]): Promise<void> {
  const visit = async (node: JsonNode): Promise<void> => {
    if (node?.kind !== 'element') return;
    if (node.attrs?.src && /^https?:/i.test(node.attrs.src) && !isDataUrl(node.attrs.src)) {
      const original = node.attrs.src;
      const dataUri = await cachedFetchDataUrl(original);
      if (dataUri) node.attrs.src = dataUri;
      else node.attrs['data-image-error'] = original;
    }
    if (node.style?.['background-image']) {
      const info = extractBackgroundUrl(node.style['background-image']);
      if (info) {
        const bgData = await cachedFetchDataUrl(info.url);
        if (bgData) node.style['background-image'] = node.style['background-image'].replace(info.match, `url("${bgData}")`);
        else node.style['--image-error'] = info.url;
      }
    }
    if (node.children?.length) {
      await Promise.all(node.children.map((child) => visit(child)));
    }
  };
  await Promise.all(nodes.map((node) => visit(node)));
}

const CAPTURE_SERVER_URL = 'http://localhost:3322';

async function tryChromiumCapture(html: string, viewport: { width: number; height: number }): Promise<JsonNode[] | null> {
  try {
    const response = await fetch(`${CAPTURE_SERVER_URL}/capture-html?width=${viewport.width}&height=${viewport.height}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/html' },
      body: html,
    });
    if (!response.ok) {
      console.warn('Chromium capture server returned error:', response.status);
      return null;
    }
    const data = await response.json();
    return data.payload || null;
  } catch (error) {
    console.warn('Chromium capture server not available, falling back to iframe:', error);
    return null;
  }
}

function buildPayloadComputed(raw: string, viewport: { width: number; height: number }): Promise<JsonNode[]> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-99999px';
    iframe.style.top = '-99999px';
    iframe.style.width = `${viewport.width}px`;
    iframe.style.height = `${viewport.height}px`;
    // No sandbox to allow external scripts like Tailwind CDN to run
    document.body.appendChild(iframe);
    
    // Write to iframe document directly for better script execution
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (iframeDoc) {
      iframeDoc.open();
      iframeDoc.write(raw);
      iframeDoc.close();
    }

    const done = () => {
      try {
        const win = iframe.contentWindow;
        const doc = iframe.contentDocument || win?.document;
        if (!win || !doc?.body) {
          console.error('No window or body');
          resolve([]);
          return;
        }
        const out: JsonNode[] = [];
        console.log('Body children count:', doc.body.childNodes.length);
        for (const child of Array.from(doc.body.childNodes)) {
          const node = nodeToJsonComputed(win, child);
          if (node) {
            console.log('Parsed node:', node.kind, node.kind === 'element' ? (node as any).tag : '');
            out.push(node);
          }
        }
        console.log('Total nodes parsed:', out.length);
        resolve(out);
      } catch (error) {
        console.error('Failed to build payload', error);
        resolve([]);
      }
      globalThis.setTimeout(() => iframe.remove(), 0);
    };

    // Give scripts time to apply styles (increased for Tailwind CDN)
    globalThis.setTimeout(done, 1500);
  });
}

async function buildPayload(raw: string, viewport: { width: number; height: number }): Promise<JsonNode[]> {
  // Try Chromium capture server first for more accurate computed styles
  const chromiumResult = await tryChromiumCapture(raw, viewport);
  if (chromiumResult && chromiumResult.length > 0) {
    console.log('Using Chromium capture server result');
    return chromiumResult;
  }
  // Fallback to iframe-based parsing
  console.log('Using iframe fallback for parsing');
  return buildPayloadComputed(raw, viewport);
}

if (importBtn) {
  importBtn.onclick = async () => {
    const raw = (htmlInput?.value || '').trim();
    if (!raw) {
      safePost({ type: 'error', message: 'Paste some HTML first.' });
      return;
    }
    const vw = Number.parseInt(viewportWidthInput?.value || '1920', 10) || 1920;
    const vh = Number.parseInt(viewportHeightInput?.value || '1080', 10) || 1080;
    clearFontMessages();
    try {
      const payload = await buildPayload(raw, { width: vw, height: vh });
      await embedExternalAssets(payload);
      safePost({
        type: 'import-html',
        payload,
        options: { 
          autoLayout: Boolean(autoLayoutCheckbox?.checked), 
          createStyles: true, 
          prototypeLinks: true,
          viewport: { width: vw, height: vh }
        },
      });
    } catch (error) {
      console.error(error);
      safePost({ type: 'error', message: 'Failed to prepare HTML payload.' });
    }
  };
}

if (clearBtn && htmlInput) {
  clearBtn.onclick = () => {
    htmlInput.value = '';
  };
}

window.onmessage = (event: MessageEvent) => {
  const msg = extractPluginMessage(event.data);
  if (!msg) return;
  if (msg.type === 'done') {
    alert('Imported to Figma ✓');
  } else if (msg.type === 'error') {
    alert('Error: ' + (msg.message || 'Unknown error'));
  } else if (msg.type === 'missing-fonts') {
    const fonts = msg.fonts || [];
    if (fonts.length) {
      const label = fonts.map((f) => [f.family, f.style].join(' ')).join(', ');
      pushFontMessage(`Missing fonts: ${label}`);
    }
  } else if (msg.type === 'font-substitutions') {
    const items = msg.items || [];
    if (items.length) {
      const label = items.map((entry) => entry.original + '→' + entry.fallback).join(', ');
      pushFontMessage(`Substituted fonts: ${label}`);
    }
  }
};
