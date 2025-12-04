/* Simple capture server: renders a URL with Playwright Chromium and returns a computed-style JSON tree suitable for the plugin. */
const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 3322;

// Extended style keys for comprehensive capture
const STYLE_KEYS = [
  // Typography
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 
  'text-decoration', 'line-height', 'letter-spacing', 'text-align', 'text-transform',
  // Background
  'background-color', 'background-image', 'background-size', 'background-position',
  // Border
  'border', 'border-style', 'border-color', 'border-width', 
  'border-radius', 'border-top-left-radius', 'border-top-right-radius', 
  'border-bottom-right-radius', 'border-bottom-left-radius',
  // Effects
  'box-shadow', 'opacity', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-opacity', 'stroke-opacity',
  // Layout
  'display', 'flex-direction', 'justify-content', 'align-items', 'flex-wrap',
  'gap', 'row-gap', 'column-gap',
  // Grid
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  // Dimensions
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  // Spacing
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  // Positioning
  'position', 'top', 'right', 'bottom', 'left', 'z-index',
  // Transform
  'transform', 'transform-origin'
];

async function capture(url, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ 
    viewport: viewport || { width: 1440, height: 900 },
    // Enable font loading
    javaScriptEnabled: true,
  });
  const page = await context.newPage();
  
  // Wait for fonts to load
  await page.goto(url, { waitUntil: 'networkidle' });
  
  // Wait for web fonts to load
  await page.evaluate(() => document.fonts.ready);
  
  // Additional time for framework rendering
  await page.waitForTimeout(300);

  const tree = await page.evaluate((styleKeys) => {
    function pickComputedStyle(win, el) {
      const cs = win.getComputedStyle(el);
      const style = {};
      for (const k of styleKeys) {
        const v = cs.getPropertyValue(k);
        if (v && v !== 'none' && v !== 'normal' && v !== 'auto') {
          style[k] = v.trim();
        }
      }
      // Always include font-family even if it's the default
      const fontFamily = cs.getPropertyValue('font-family');
      if (fontFamily) style['font-family'] = fontFamily.trim();
      
      // Always include font-size
      const fontSize = cs.getPropertyValue('font-size');
      if (fontSize) style['font-size'] = fontSize.trim();
      
      // Always include color
      const color = cs.getPropertyValue('color');
      if (color) style['color'] = color.trim();
      
      // Always include background-color (even if transparent)
      const bgColor = cs.getPropertyValue('background-color');
      if (bgColor) style['background-color'] = bgColor.trim();
      
      if (el.id) style['--node-id'] = el.id;
      return style;
    }
    
    function nodeToJsonComputed(win, node) {
      if (node.nodeType === win.Node.TEXT_NODE) {
        const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!text) return null;
        return { kind: 'text', text };
      }
      if (node.nodeType !== win.Node.ELEMENT_NODE) return null;
      const el = node;
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'head' || tag === 'noscript') return null;
      const attrs = {};
      for (const a of el.attributes) attrs[a.name] = a.value;
      const style = pickComputedStyle(win, el);
      const children = [];
      for (const child of el.childNodes) {
        const n = nodeToJsonComputed(win, child);
        if (n) children.push(n);
      }
      return { kind: 'element', tag, attrs, style, children };
    }

    const out = [];
    for (const child of document.body.childNodes) {
      const node = nodeToJsonComputed(window, child);
      if (node) out.push(node);
    }
    return out;
  }, STYLE_KEYS);

  await browser.close();
  return tree;
}

async function captureHtml(htmlContent, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ 
    viewport: viewport || { width: 1440, height: 900 },
    javaScriptEnabled: true,
  });
  const page = await context.newPage();
  
  // Set content directly
  await page.setContent(htmlContent, { waitUntil: 'networkidle' });
  
  // Wait for web fonts to load
  await page.evaluate(() => document.fonts.ready);
  
  // Wait for Tailwind CDN and other frameworks to process (increased timeout)
  await page.waitForTimeout(1000);
  
  // Extra wait to ensure all styles are computed
  await page.evaluate(() => {
    return new Promise(resolve => {
      // Force a reflow to ensure styles are computed
      document.body.offsetHeight;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });

  const tree = await page.evaluate((styleKeys) => {
    function pickComputedStyle(win, el) {
      const cs = win.getComputedStyle(el);
      const style = {};
      for (const k of styleKeys) {
        const v = cs.getPropertyValue(k);
        if (v && v !== 'none' && v !== 'normal' && v !== 'auto') {
          style[k] = v.trim();
        }
      }
      // Always include font-family even if it's the default
      const fontFamily = cs.getPropertyValue('font-family');
      if (fontFamily) style['font-family'] = fontFamily.trim();
      
      // Always include font-size
      const fontSize = cs.getPropertyValue('font-size');
      if (fontSize) style['font-size'] = fontSize.trim();
      
      // Always include color
      const color = cs.getPropertyValue('color');
      if (color) style['color'] = color.trim();
      
      // Always include background-color
      const bgColor = cs.getPropertyValue('background-color');
      if (bgColor) style['background-color'] = bgColor.trim();
      
      if (el.id) style['--node-id'] = el.id;
      return style;
    }
    
    function nodeToJsonComputed(win, node) {
      if (node.nodeType === win.Node.TEXT_NODE) {
        const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!text) return null;
        return { kind: 'text', text };
      }
      if (node.nodeType !== win.Node.ELEMENT_NODE) return null;
      const el = node;
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'head' || tag === 'noscript') return null;
      const attrs = {};
      for (const a of el.attributes) attrs[a.name] = a.value;
      const style = pickComputedStyle(win, el);
      const children = [];
      for (const child of el.childNodes) {
        const n = nodeToJsonComputed(win, child);
        if (n) children.push(n);
      }
      return { kind: 'element', tag, attrs, style, children };
    }

    const out = [];
    for (const child of document.body.childNodes) {
      const node = nodeToJsonComputed(window, child);
      if (node) out.push(node);
    }
    return out;
  }, STYLE_KEYS);

  await browser.close();
  return { tree, viewport: viewport || { width: 1440, height: 900 } };
}

async function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ limit: '10mb', type: 'text/html' }));

  // Capture from URL
  app.get('/capture', async (req, res) => {
    const url = req.query.url;
    const width = parseInt(req.query.width) || 1440;
    const height = parseInt(req.query.height) || 900;
    if (!url) return res.status(400).json({ error: 'Missing url' });
    try {
      const data = await capture(String(url), { width, height });
      res.json({ payload: data, viewport: { width, height } });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Capture from raw HTML content
  app.post('/capture-html', async (req, res) => {
    const width = parseInt(req.query.width) || 1440;
    const height = parseInt(req.query.height) || 900;
    let htmlContent = '';
    
    if (typeof req.body === 'string') {
      htmlContent = req.body;
    } else if (req.body && req.body.html) {
      htmlContent = req.body.html;
    }
    
    if (!htmlContent) {
      return res.status(400).json({ error: 'Missing HTML content' });
    }
    
    try {
      const result = await captureHtml(htmlContent, { width, height });
      res.json({ payload: result.tree, viewport: result.viewport });
    } catch (e) {
      console.error('Capture error:', e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.listen(PORT, () => console.log(`capture server listening on http://localhost:${PORT}`));
}

createServer();
