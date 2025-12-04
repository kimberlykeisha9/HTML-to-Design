/* eslint-disable @typescript-eslint/no-explicit-any */

import gradientParser, { GradientColorStop, GradientNode } from 'gradient-parser';

type JsonNode =
  | { kind: 'text'; text: string }
  | {
      kind: 'element';
      tag: string;
      attrs: Record<string, string>;
      style: Record<string, string>;
      children: JsonNode[];
    };

type ElementNode = Extract<JsonNode, { kind: 'element' }>;

type ImportMessage = {
  type: 'import-html';
  payload: JsonNode[];
  options?: { 
    autoLayout?: boolean; 
    fontMap?: Record<string,string>; 
    createStyles?: boolean; 
    prototypeLinks?: boolean;
    viewport?: { width: number; height: number };
  };
};

type UiErrorMessage = { type: 'error'; message?: string };

type GridMeta = {
  columns: number;
  columnGap: number;
  rowGap: number;
  childCount: number;
  rows: FrameNode[];
  columnWidths: number[];
  totalWidth?: number;
};

type FontSubstitution = { original: string; fallback: string };

const FONT_FALLBACKS: Record<string, string> = {
  'Roboto': 'Inter',
  'Open Sans': 'Inter',
  'Montserrat': 'Inter',
  'Lato': 'Inter',
  'Poppins': 'Inter',
  'Source Sans Pro': 'Inter',
  'Raleway': 'Inter',
  'Nunito': 'Inter',
  'Ubuntu': 'Inter',
  'Mukta': 'Inter',
  'PT Sans': 'Arial',
  'Merriweather': 'Georgia',
  'Playfair Display': 'Georgia',
  'Oswald': 'Arial Black'
};

const fontAliasMap = new Map<string, FontName>();
const imagePaintCache = new Map<string, Promise<Uint8Array | null>>();

const HEADING_TAGS = new Set(['h1','h2','h3','h4','h5','h6']);
const INLINE_TEXT_TAGS = new Set(['p','span','a','li','strong','em','u','s','b','i','label','small','mark','code','pre','blockquote']);
const LIST_CONTAINER_TAGS = new Set(['ul','ol']);
const BUTTON_TAGS = new Set(['button','input','textarea']);
const SVG_TAGS = new Set(['svg','path','circle','rect','line','polyline','polygon','ellipse','g','defs','use','symbol','text','tspan']);
const HEADING_SIZES: Record<string, number> = { h1: 32, h2: 24, h3: 20, h4: 18, h5: 16, h6: 14 };

function escapeXmlAttr(value: string): string {
  return value.replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function buildSvgElementString(node: JsonNode): string {
  if (node.kind === 'text') {
    return node.text;
  }
  const tag = node.tag;
  const attrs = node.attrs || {};

  // Build attributes string, excluding 'class' and 'style' since we handle computed styles separately
  const existingAttrPairs = Object.entries(attrs)
    .filter(([key]) => key !== 'class' && key !== 'style')
    .map(([key, value]) => `${key}="${escapeXmlAttr(value)}"`);

  const existingKeys = new Set(Object.keys(attrs));
  const computedStyle = node.style || {};
  const styleDrivenAttrs = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-opacity', 'stroke-opacity', 'opacity'];
  const computedAttrPairs = styleDrivenAttrs
    .filter((key) => computedStyle[key] && !existingKeys.has(key))
    .map((key) => `${key}="${escapeXmlAttr(computedStyle[key] ?? '')}"`);

  const allAttrPairs = [...existingAttrPairs, ...computedAttrPairs];
  const attrsStr = allAttrPairs.length ? ' ' + allAttrPairs.join(' ') : '';
  
  // Self-closing tags
  const selfClosing = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use'];
  if (selfClosing.includes(tag) && (!node.children || node.children.length === 0)) {
    return `<${tag}${attrsStr}/>`;
  }
  
  const children = (node.children || []).map(buildSvgElementString).join('');
  return `<${tag}${attrsStr}>${children}</${tag}>`;
}

function reconstructSvgString(el: ElementNode): string | null {
  try {
    // Ensure the SVG has the xmlns attribute
    const svgAttrs = { ...el.attrs };
    if (!svgAttrs['xmlns']) {
      svgAttrs['xmlns'] = 'http://www.w3.org/2000/svg';
    }
    const modifiedEl = { ...el, attrs: svgAttrs };
    return buildSvgElementString(modifiedEl as JsonNode);
  } catch (error) {
    console.warn('Failed to reconstruct SVG string:', error);
    return null;
  }
}

function fontNameOf(family: string, style: string): FontName {
  return { family, style };
}

function stripQuotes(value: string): string {
  return value.replaceAll(/^['"]+/g, '').replaceAll(/['"]+$/g, '');
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function colorStopToColor(stop: GradientColorStop): { r: number; g: number; b: number; a: number } | null {
  if (!stop) return null;
  if (stop.type === 'hex') return parseColorWithAlpha(`#${stop.value}`);
  if (stop.type === 'literal' && typeof stop.value === 'string') return parseColorWithAlpha(stop.value);
  if (stop.type === 'rgb' || stop.type === 'rgba') {
    const fn = stop.type === 'rgb' ? 'rgb' : 'rgba';
    const args = Array.isArray(stop.value) ? stop.value.join(',') : stop.value;
    return parseColorWithAlpha(`${fn}(${args})`);
  }
  if (typeof stop.value === 'string') return parseColorWithAlpha(stop.value);
  return null;
}

function resolveGradientAngle(gradient: GradientNode): number {
  const orientation = gradient?.orientation;
  if (!orientation) return 180;
  const source = Array.isArray(orientation) ? orientation[0] : orientation;
  if (!source) return 180;
  const angularValue = typeof source.value === 'string' ? source.value : source.value?.value;
  if (source.type === 'angular' && angularValue !== undefined) {
    return Number(angularValue) || 180;
  }
  if (source.type === 'directional' && source.value) {
    const dir = String(angularValue ?? source.value).toLowerCase();
    const map: Record<string, number> = {
      'to top': 0,
      'to top right': 45,
      'to right top': 45,
      'to right': 90,
      'to bottom right': 135,
      'to right bottom': 135,
      'to bottom': 180,
      'to bottom left': 225,
      'to left bottom': 225,
      'to left': 270,
      'to left top': 315,
      'to top left': 315
    };
    if (map[dir] !== undefined) return map[dir];
  }
  return 180;
}

function gradientTransformFromAngle(angleDeg: number): Transform {
  const radians = ((angleDeg % 360) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    [cos, sin, 0.5 - 0.5 * cos - 0.5 * sin],
    [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos]
  ];
}

function parseGradientPaint(value?: string): GradientPaint | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized || normalized === 'none' || !normalized.includes('gradient')) return null;
  try {
    const ast = gradientParser.parse(normalized);
    if (!ast?.length) return null;
    const gradient = ast[0];
    const type = gradient.type?.includes('radial') ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR';
    const stopsRaw = gradient.colorStops || [];
    const stops = stopsRaw
      .map((stop, index: number) => {
        const color = colorStopToColor(stop);
        if (!color) return null;
        let position: number | undefined;
        if (stop.length) {
          if (stop.length.type === '%') {
            position = clamp01(Number(stop.length.value) / 100);
          }
        }
        return { color, position, index };
      })
      .filter(Boolean) as { color: { r: number; g: number; b: number; a: number }; position?: number; index: number }[];
    if (!stops.length) return null;
    const total = stops.length - 1 || 1;
    for (const stop of stops) {
      if (stop.position === undefined) {
        stop.position = total === 0 ? 0 : stop.index / total;
      } else {
        stop.position = clamp01(stop.position);
      }
    }
    const gradientStops = stops.map((stop) => ({
      position: stop.position ?? 0,
      color: stop.color
    }));
    return {
      type,
      gradientStops,
      gradientTransform: type === 'GRADIENT_LINEAR' ? gradientTransformFromAngle(resolveGradientAngle(gradient)) : [[1, 0, 0], [0, 1, 0]]
    } as GradientPaint;
  } catch (error) {
    console.warn('Failed to parse gradient', error);
    return null;
  }
}

function extractImageReference(value?: string): string | null {
  if (!value) return null;
  const urlPattern = /url\((['"]?)(.+?)\1\)/i;
  const match = urlPattern.exec(value);
  return match ? match[2] : null;
}

async function fetchImageBytes(src: string): Promise<Uint8Array | null> {
  if (!src) return null;
  if (imagePaintCache.has(src)) return imagePaintCache.get(src)!;
  const task = (async () => {
    if (src.startsWith('data:')) {
      const base64 = src.split(',')[1];
      if (!base64) return null;
      return figma.base64Decode(base64);
    }
    try {
      const response = await fetch(src);
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      console.warn('Failed to fetch image', src, error);
      return null;
    }
  })();
  imagePaintCache.set(src, task);
  return task;
}

async function createImagePaintFromSource(src: string, style?: Record<string, string>): Promise<ImagePaint | null> {
  const bytes = await fetchImageBytes(src);
  if (!bytes) return null;
  const image = figma.createImage(bytes);
  const size = (style?.['background-size'] || '').toLowerCase();
  let scaleMode: ImagePaint['scaleMode'] = 'FILL';
  if (size.includes('contain')) {
    scaleMode = 'FIT';
  } else if (size.includes('tile')) {
    scaleMode = 'TILE';
  }
  const paint: ImagePaint = {
    type: 'IMAGE',
    imageHash: image.hash,
    scaleMode
  };
  return paint;
}

  function scheduleBackgroundFill(node: FrameNode | RectangleNode, style: Record<string, string>, pending: Promise<void>[]) {
    const appliedGradient = parseGradientPaint(style['background-image']);
    if (appliedGradient) {
      node.fills = [appliedGradient];
      return true;
    }
    const imageRef = extractImageReference(style['background-image']);
    if (imageRef) {
      pending.push((async () => {
        const paint = await createImagePaintFromSource(imageRef, style);
        if (paint) {
          node.fills = [paint];
        }
      })());
      return true;
    }
    return false;
  }

  function scheduleImageFill(node: GeometryMixin, src: string | undefined, pending: Promise<void>[], style?: Record<string, string>) {
    if (!src) return;
    pending.push((async () => {
      const paint = await createImagePaintFromSource(src, style);
      if (paint) {
        node.fills = [paint];
      }
    })());
  }

async function tryLoadFont(font: FontName): Promise<boolean> {
  try {
    await figma.loadFontAsync(font);
    return true;
  } catch {
    return false;
  }
}

function buildFontAttempts(font: { family: string; style: string }): FontName[] {
  let attempts: FontName[] = [fontNameOf(font.family, font.style)];
  const fallbackFamily = FONT_FALLBACKS[font.family];
  if (fallbackFamily) {
    attempts = attempts.concat(
      fontNameOf(fallbackFamily, font.style),
      fontNameOf(fallbackFamily, 'Regular')
    );
  }
  return attempts.concat(fontNameOf('Inter', 'Regular'));
}

async function loadFontWithFallback(font: { family: string; style: string }): Promise<{ fontName: FontName; substituted: boolean } | null> {
  for (const attempt of buildFontAttempts(font)) {
    if (await tryLoadFont(attempt)) {
      const substituted = attempt.family !== font.family || attempt.style !== font.style;
      return { fontName: attempt, substituted };
    }
  }
  return null;
}

function countGridTracks(template?: string): number {
  if (!template || template === 'none') return 0;
  let count = 0;
  const repeatRegex = /repeat\(\s*(\d+)\s*,/gi;
  let match: RegExpExecArray | null;
  while ((match = repeatRegex.exec(template))) {
    count += Number(match[1]) || 0;
  }
  const stripped = template.replaceAll(repeatRegex, ' ');
  // Count tokens that look like track sizes (numbers with units, auto, etc.)
  const tokens = stripped.trim().split(/\s+/).filter(t => {
    if (!t) return false;
    // Match common track size patterns: numbers with optional units, or keywords
    return /^\d/.test(t) || ['auto', 'min-content', 'max-content'].includes(t.toLowerCase()) || t.startsWith('minmax(');
  });
  count += tokens.length;
  return count;
}

// WeakMap to store grid metadata for frames (avoids modifying non-extensible objects)
const gridMetaMap = new WeakMap<FrameNode, GridMeta>();

function parseGridColumnWidths(template?: string): number[] {
  if (!template || template === 'none') return [];
  const widths: number[] = [];
  const tokens = template.trim().split(/\s+/);
  for (const token of tokens) {
    const px = parsePx(token);
    if (px !== undefined) {
      widths.push(px);
    }
  }
  return widths;
}

function initGridMeta(frame: FrameNode, style: Record<string, string>) {
  const columns = countGridTracks(style['grid-template-columns']) || 2;
  const columnWidths = parseGridColumnWidths(style['grid-template-columns']);
  const columnGap = parsePx(style['column-gap']) ?? parsePx(style['gap']) ?? 0;
  const rowGap = parsePx(style['row-gap']) ?? parsePx(style['gap']) ?? 0;
  
  // Calculate total width from column widths if available
  const totalWidth = columnWidths.length > 0 
    ? columnWidths.reduce((a, b) => a + b, 0) + (columnGap * (columnWidths.length - 1))
    : undefined;
  
  const meta: GridMeta = {
    columns: Math.max(1, columns),
    columnGap,
    rowGap,
    childCount: 0,
    rows: [],
    columnWidths,
    totalWidth
  };
  gridMetaMap.set(frame, meta);
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = totalWidth ? 'FIXED' : 'AUTO';
  if (totalWidth) {
    frame.resize(totalWidth, frame.height);
  }
  frame.itemSpacing = rowGap;
}

function isGridFrame(node: SceneNode): node is FrameNode {
  if (node.type !== 'FRAME') return false;
  return gridMetaMap.has(node);
}

function appendToGridFrame(parent: FrameNode, child: SceneNode) {
  const meta = gridMetaMap.get(parent);
  if (!meta) {
    parent.appendChild(child);
    return;
  }
  const columns = Math.max(1, meta.columns);
  const index = meta.childCount;
  const rowIndex = Math.floor(index / columns);
  const colIndex = index % columns;
  let row = meta.rows[rowIndex];
  if (!row) {
    row = figma.createFrame();
    row.name = `row-${rowIndex + 1}`;
    row.layoutMode = 'HORIZONTAL';
    row.primaryAxisSizingMode = meta.totalWidth ? 'FIXED' : 'AUTO';
    row.counterAxisSizingMode = 'AUTO'; // Height hugs content
    if (meta.totalWidth) {
      row.resize(meta.totalWidth, row.height);
      row.layoutSizingHorizontal = 'FIXED';
    } else {
      row.layoutSizingHorizontal = 'FILL';
    }
    row.layoutSizingVertical = 'HUG'; // Ensure row height hugs content
    row.paddingTop = 0;
    row.paddingRight = 0;
    row.paddingBottom = 0;
    row.paddingLeft = 0;
    row.itemSpacing = meta.columnGap;
    row.fills = [];
    row.strokes = [];
    row.clipsContent = false;
    parent.appendChild(row);
    meta.rows[rowIndex] = row;
  }
  
  // Apply specific column width if available
  if (meta.columnWidths.length > colIndex && child.type === 'FRAME') {
    const colWidth = meta.columnWidths[colIndex];
    const frame = child as FrameNode;
    frame.layoutSizingHorizontal = 'FIXED';
    frame.layoutSizingVertical = 'HUG'; // Ensure height hugs content
    frame.resize(colWidth, frame.height);
  } else if ('layoutGrow' in child) {
    // Fallback to equal distribution
    try {
      (child as LayoutMixin).layoutGrow = 1;
    } catch { /* ignore */ }
  }
  row.appendChild(child);
  meta.childCount = index + 1;
}

function splitShadowList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseShadowDefinition(value: string) {
  const tokens = value.split(/\s+/).filter(Boolean);
  let inset = false;
  const numbers: number[] = [];
  let color: { r: number; g: number; b: number; a: number } | null = null;
  
  // Handle rgba() which contains commas and spaces
  const rgbaMatch = /rgba?\s*\([^)]+\)/i.exec(value);
  if (rgbaMatch) {
    color = parseColorWithAlpha(rgbaMatch[0]);
  }
  
  for (const token of tokens) {
    if (token.toLowerCase() === 'inset') {
      inset = true;
      continue;
    }
    // Skip if this token is part of the rgba() we already parsed
    if (rgbaMatch && rgbaMatch[0].includes(token)) {
      continue;
    }
    const px = parsePx(token);
    if (px !== undefined) {
      numbers.push(px);
      continue;
    }
    // Try parsing as plain number (for cases like '11px')
    const num = parseFloat(token);
    if (!isNaN(num)) {
      numbers.push(num);
      continue;
    }
    if (!color) {
      const parsedColor = parseColorWithAlpha(token);
      if (parsedColor) {
        color = parsedColor;
      }
    }
  }
  if (numbers.length < 2) return null;
  // CSS box-shadow: offset-x offset-y blur-radius spread-radius color
  const [offsetX, offsetY, blur = 0, spread = 0] = numbers;
  return { inset, offsetX, offsetY, blur, spread, color };
}

function parseColor(v?: string | null) {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    const norm = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = Number.parseInt(norm.slice(0, 2), 16) / 255;
    const g = Number.parseInt(norm.slice(2, 4), 16) / 255;
    const b = Number.parseInt(norm.slice(4, 6), 16) / 255;
    return { r, g, b };
  }
  const re = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/;
  const m = re.exec(s);
  if (m) {
    return { r: Number(m[1]) / 255, g: Number(m[2]) / 255, b: Number(m[3]) / 255 };
  }
  return null;
}

function parseColorWithAlpha(v?: string | null): { r: number; g: number; b: number; a: number } | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith('#')) {
    const base = parseColor(s);
    return base ? { r: base.r, g: base.g, b: base.b, a: 1 } : null;
  }
  // Modern syntax: rgb(r g b) or rgb(r g b / a) or rgba(r, g, b, a)
  // Also handles percentages like rgb(36% 58% 52%)
  const modernRe = /rgba?\s*\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)/;
  const modernMatch = modernRe.exec(s);
  if (modernMatch) {
    const parseVal = (val: string) => {
      if (val.endsWith('%')) return parseFloat(val) / 100 * 255;
      return parseFloat(val);
    };
    const parseAlpha = (val?: string) => {
      if (!val) return 1;
      if (val.endsWith('%')) return parseFloat(val) / 100;
      return parseFloat(val);
    };
    return {
      r: parseVal(modernMatch[1]) / 255,
      g: parseVal(modernMatch[2]) / 255,
      b: parseVal(modernMatch[3]) / 255,
      a: parseAlpha(modernMatch[4])
    };
  }
  // Legacy syntax: rgb(r, g, b) or rgba(r, g, b, a)
  const legacyRe = /rgba?\s*\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)(?:\s*,\s*([\d.]+%?))?\s*\)/;
  const legacyMatch = legacyRe.exec(s);
  if (legacyMatch) {
    const parseVal = (val: string) => {
      if (val.endsWith('%')) return parseFloat(val) / 100 * 255;
      return parseFloat(val);
    };
    const parseAlpha = (val?: string) => {
      if (!val) return 1;
      if (val.endsWith('%')) return parseFloat(val) / 100;
      return parseFloat(val);
    };
    return {
      r: parseVal(legacyMatch[1]) / 255,
      g: parseVal(legacyMatch[2]) / 255,
      b: parseVal(legacyMatch[3]) / 255,
      a: parseAlpha(legacyMatch[4])
    };
  }
  return null;
}

function parsePx(v?: string) {
  if (!v) return undefined;
  const re = /(-?\d+(?:\.\d+)?)px/;
  const m = re.exec(v.trim());
  return m ? Number(m[1]) : undefined;
}

function parseNumber(v?: string) {
  if (!v) return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : undefined;
}

function getBox(style: Record<string, string>, base: 'margin' | 'padding') {
  const one = style[base];
  const top = parsePx(style[`${base}-top`]);
  const right = parsePx(style[`${base}-right`]);
  const bottom = parsePx(style[`${base}-bottom`]);
  const left = parsePx(style[`${base}-left`]);
  let t = top, r = right, b = bottom, l = left;
  if (one) {
    const parts = one.split(/\s+/).filter(Boolean);
    const vals = parts.map(parsePx);
    if (vals.length === 1 && vals[0] !== undefined) t = r = b = l = vals[0];
    else if (vals.length === 2 && vals[0] !== undefined && vals[1] !== undefined) {
      t = b = vals[0]; r = l = vals[1];
    } else if (vals.length === 3 && vals[0] !== undefined && vals[1] !== undefined && vals[2] !== undefined) {
      t = vals[0]; r = l = vals[1]; b = vals[2];
    } else if (vals.length === 4) {
      [t, r, b, l] = vals as number[];
    }
  }
  return { top: t ?? 0, right: r ?? 0, bottom: b ?? 0, left: l ?? 0 };
}

function applyBorder(node: FrameNode | RectangleNode, style: Record<string, string>) {
  // border shorthand e.g. "1px solid #000" and individual width/color
  let width = parsePx(style['border-width']);
  let color = parseColorWithAlpha(style['border-color']);
  const shorthand = style['border'];
  if (shorthand) {
    const tokens = shorthand.split(/\s+/);
    for (const tk of tokens) {
      const w = parsePx(tk);
      if (w !== undefined) width = w;
      const c = parseColorWithAlpha(tk);
      if (c) color = c;
    }
  }
  if (width !== undefined && color && color.a > 0) {
    node.strokes = [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a }];
    node.strokeAlign = 'INSIDE';
    node.strokeWeight = width;
  }
}

function applyBoxShadow(node: FrameNode | RectangleNode, style: Record<string, string>) {
  const sh = style['box-shadow'];
  if (!sh || sh === 'none') return;
  const entries = splitShadowList(sh);
  const effects: (DropShadowEffect | InnerShadowEffect)[] = [];
  for (const entry of entries) {
    const parsed = parseShadowDefinition(entry);
    if (!parsed) continue;
    const effect: DropShadowEffect | InnerShadowEffect = {
      type: parsed.inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
      radius: parsed.blur,
      spread: parsed.spread,
      visible: true,
      blendMode: 'NORMAL',
      offset: { x: parsed.offsetX, y: parsed.offsetY },
      color: parsed.color || { r: 0, g: 0, b: 0, a: 0.25 }
    } as DropShadowEffect;
    effects.push(effect);
  }
  if (effects.length) {
    node.effects = effects;
  }
}

function childrenText(children?: JsonNode[]): string {
  if (!children?.length) return '';
  let out = '';
  for (const c of children) {
    if ((c as any).kind === 'text') out += (c as any).text + ' ';
    else out += childrenText((c as any).children) + ' ';
  }
  return out.trim();
}

function hexOf(color: RGB): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

async function ensureFonts(fonts: { family: string; style: string }[]): Promise<{ missing: { family: string; style: string }[]; substitutions: FontSubstitution[] }> {
  const loaded = new Set<string>();
  const missing: { family: string; style: string }[] = [];
  const substitutions: FontSubstitution[] = [];
  for (const font of fonts) {
    const key = `${font.family}__${font.style}`;
    if (loaded.has(key)) continue;
    const result = await loadFontWithFallback(font);
    if (result) {
      loaded.add(key);
      fontAliasMap.set(key, result.fontName);
      if (result.substituted) {
        substitutions.push({ original: `${font.family} ${font.style}`, fallback: `${result.fontName.family} ${result.fontName.style}` });
      }
    } else {
      missing.push({ family: font.family, style: font.style });
    }
  }
  return { missing, substitutions };
}

function resolveFontFamily(style: Record<string, string>): string {
  const raw = style['font-family'] || '';
  const candidates = raw
    .split(',')
    .map((s) => stripQuotes(s.trim()))
    .filter(Boolean);
  if (candidates.length) return candidates[0];
  return 'Inter';
}

function resolveFontStyleName(style: Record<string, string>): string {
  const weightRaw = (style['font-weight'] || '').toLowerCase();
  let weightNum = 400;
  if (/^\d+$/.test(weightRaw)) {
    weightNum = Number(weightRaw);
  } else if (weightRaw.includes('bold')) {
    weightNum = 700;
  }
  const italic = (style['font-style'] || '').toLowerCase().includes('italic');
  if (weightNum >= 700) return italic ? 'Bold Italic' : 'Bold';
  return italic ? 'Italic' : 'Regular';
}

function hasTextChildren(children: JsonNode[]): boolean {
  return children.some(child => (child as any).kind === 'text');
}

function collectFontsFromNodes(nodes: JsonNode[], out: Set<string>) {
  for (const n of nodes) {
    if ((n as any).kind === 'element') {
      const el = n as Extract<JsonNode, { kind: 'element' }>;
      // Textual tags we render as text
      const texty = ['h1','h2','h3','h4','h5','h6','p','span','a','li','strong','em','u','s','button','label','input','textarea'];
      // Collect fonts for text tags OR for elements that have text children (like divs with text)
      if (texty.includes(el.tag) || hasTextChildren(el.children || [])) {
        const family = resolveFontFamily(el.style);
        const styleName = resolveFontStyleName(el.style);
        out.add(`${family}__${styleName}`);
      }
      if (el.children?.length) collectFontsFromNodes(el.children, out);
    }
  }
}

async function prepareFontsForPayload(nodes: JsonNode[]): Promise<{ missing: { family: string; style: string }[]; substitutions: FontSubstitution[] }> {
  const fontKeys = new Set<string>();
  collectFontsFromNodes(nodes || [], fontKeys);
  if (!fontKeys.size) fontKeys.add('Inter__Regular');
  const fontsToLoad = Array.from(fontKeys).map((key) => {
    const [family, styleName] = key.split('__');
    return { family, style: styleName } as { family: string; style: string };
  });
  return ensureFonts(fontsToLoad);
}

function applyTextStyle(t: TextNode, style: Record<string, string>) {
  const size = parsePx(style['font-size']);
  if (size) {
    t.fontSize = size;
  }
  const color = parseColorWithAlpha(style['color']);
  if (color && color.a > 0) t.fills = [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a }];
  const family = resolveFontFamily(style);
  const styleName = resolveFontStyleName(style);
  try {
    const alias = fontAliasMap.get(`${family}__${styleName}`);
    t.fontName = alias ?? fontNameOf(family, styleName);
  } catch { /* empty */ }

  // Handle line-height: can be px, unitless multiplier, or percentage
  const lhRaw = style['line-height'];
  if (lhRaw && lhRaw !== 'normal') {
    const lhPx = parsePx(lhRaw);
    if (lhPx) {
      t.lineHeight = { unit: 'PIXELS', value: lhPx };
    } else {
      // Try parsing as a unitless number (multiplier)
      const lhNum = parseFloat(lhRaw);
      if (!isNaN(lhNum) && lhNum > 0) {
        // Convert multiplier to percentage (1.5 = 150%)
        t.lineHeight = { unit: 'PERCENT', value: lhNum * 100 };
      }
    }
  }
  
  const ls = parsePx(style['letter-spacing']);
  if (ls !== undefined) t.letterSpacing = { unit: 'PIXELS', value: ls };
  const td = (style['text-decoration'] || '').toLowerCase();
  if (td.includes('underline')) t.textDecoration = 'UNDERLINE';
  if (td.includes('line-through') || td.includes('strikethrough')) t.textDecoration = 'STRIKETHROUGH';
  const ta = (style['text-align'] || '').toLowerCase();
  if (ta === 'center') t.textAlignHorizontal = 'CENTER';
  else if (ta === 'right') t.textAlignHorizontal = 'RIGHT';
  else t.textAlignHorizontal = 'LEFT';
  const tt = (style['text-transform'] || '').toLowerCase();
  if (tt === 'uppercase') t.textCase = 'UPPER';
  else if (tt === 'lowercase') t.textCase = 'LOWER';
  else if (tt === 'capitalize') t.textCase = 'TITLE';
  const opacity = parseNumber(style['opacity']);
  if (opacity !== undefined) t.opacity = Math.max(0, Math.min(1, opacity));
}

function applyFrameBoxStyle(f: FrameNode, style: Record<string, string>, opts: { autoLayout?: boolean }, pending: Promise<void>[]) {
  // Disable content clipping to prevent shadows and content from being cut off
  f.clipsContent = false;
  
  applyBackgroundPaint(f, style, pending);
  applyCornerRadiiFromStyle(f, style);
  applyBorder(f, style);
  applyBoxShadow(f, style);
  applyOpacityFromStyle(f, style);
  configureLayoutForFrame(f, style, opts);
  applyExplicitSizing(f, style);
}

function applyBackgroundPaint(node: FrameNode, style: Record<string, string>, pending: Promise<void>[]) {
  const backgroundHandled = scheduleBackgroundFill(node, style, pending);
  if (backgroundHandled) return;
  const rgba = parseColorWithAlpha(style['background-color']);
  if (rgba && rgba.a > 0) {
    node.fills = [{ type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: rgba.a }];
  } else {
    node.fills = [];
  }
}

function applyCornerRadiiFromStyle(node: FrameNode, style: Record<string, string>) {
  const uniformRadius = parsePx(style['border-radius']);
  if (uniformRadius !== undefined) node.cornerRadius = uniformRadius;
  const radii = {
    tl: parsePx(style['border-top-left-radius']),
    tr: parsePx(style['border-top-right-radius']),
    br: parsePx(style['border-bottom-right-radius']),
    bl: parsePx(style['border-bottom-left-radius'])
  };
  if (radii.tl === undefined && radii.tr === undefined && radii.br === undefined && radii.bl === undefined) return;
  const baseRadius = typeof node.cornerRadius === 'number' ? node.cornerRadius : 0;
  node.topLeftRadius = radii.tl ?? baseRadius;
  node.topRightRadius = radii.tr ?? baseRadius;
  node.bottomRightRadius = radii.br ?? baseRadius;
  node.bottomLeftRadius = radii.bl ?? baseRadius;
}

function applyOpacityFromStyle(node: FrameNode, style: Record<string, string>) {
  const opacity = parseNumber(style['opacity']);
  if (opacity === undefined) return;
  node.opacity = Math.max(0, Math.min(1, opacity));
}

function configureLayoutForFrame(node: FrameNode, style: Record<string, string>, opts: { autoLayout?: boolean }) {
  const display = (style['display'] || '').toLowerCase();
  if (display === 'grid' || display === 'inline-grid') {
    initGridMeta(node, style);
    return;
  }
  // Enable auto-layout for flex, or when autoLayout option is set, or for block elements (to stack children properly)
  const wantsAuto = opts.autoLayout || display === 'flex' || display === 'inline-flex' || display === 'block' || display === '';
  if (!wantsAuto) {
    node.layoutMode = 'NONE';
    return;
  }
  // For flex containers, use the specified direction; for block elements, default to vertical
  const isFlex = display === 'flex' || display === 'inline-flex';
  const direction = isFlex ? (style['flex-direction'] || 'row').toLowerCase() : 'column';
  node.layoutMode = direction === 'row' ? 'HORIZONTAL' : 'VERTICAL';
  node.primaryAxisSizingMode = 'AUTO';
  node.counterAxisSizingMode = 'AUTO';
  const padding = getBox(style, 'padding');
  node.paddingTop = padding.top;
  node.paddingRight = padding.right;
  node.paddingBottom = padding.bottom;
  node.paddingLeft = padding.left;
  const gapAll = parsePx(style['gap']);
  const rowGap = parsePx(style['row-gap']);
  const columnGap = parsePx(style['column-gap']);
  node.itemSpacing = direction === 'row' ? (columnGap ?? gapAll ?? 6) : (rowGap ?? gapAll ?? 6);
  const justify = (style['justify-content'] || '').toLowerCase();
  const align = (style['align-items'] || '').toLowerCase();
  node.primaryAxisAlignItems = mapPrimaryAlign(justify);
  node.counterAxisAlignItems = mapCounterAlign(align);
}

function mapPrimaryAlign(value: string): 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' {
  if (value.includes('space-between')) return 'SPACE_BETWEEN';
  if (value.includes('center')) return 'CENTER';
  if (value.includes('end')) return 'MAX';
  return 'MIN';
}

function mapCounterAlign(value: string): 'MIN' | 'CENTER' | 'MAX' {
  if (value.includes('center')) return 'CENTER';
  if (value.includes('end')) return 'MAX';
  return 'MIN';
}

function applyExplicitSizing(node: FrameNode, style: Record<string, string>) {
  const width = parsePx(style['width']);
  const height = parsePx(style['height']);
  const minHeight = parsePx(style['min-height']);
  
  if (width === undefined && height === undefined && minHeight === undefined) return;
  
  // In Figma auto-layout:
  // - VERTICAL layout: primary axis = height (vertical), counter axis = width (horizontal)
  // - HORIZONTAL layout: primary axis = width (horizontal), counter axis = height (vertical)
  const isVertical = node.layoutMode === 'VERTICAL';
  
  if (width !== undefined) {
    // Width is counter-axis for vertical, primary-axis for horizontal
    if (isVertical) {
      node.counterAxisSizingMode = 'FIXED';
    } else {
      node.primaryAxisSizingMode = 'FIXED';
    }
  }
  
  const effectiveHeight = height ?? minHeight;
  if (effectiveHeight !== undefined) {
    // Height is primary-axis for vertical, counter-axis for horizontal
    if (isVertical) {
      node.primaryAxisSizingMode = 'FIXED';
    } else {
      node.counterAxisSizingMode = 'FIXED';
    }
  }
  
  const newWidth = width ?? node.width;
  const newHeight = effectiveHeight ?? node.height;
  if (newWidth > 0 && newHeight > 0) {
    node.resize(newWidth, newHeight);
  }
}

function appendWithMargin(parent: FrameNode, child: SceneNode, style: Record<string, string>, _opts: { autoLayout?: boolean }) {
  if (isGridFrame(parent)) {
    appendToGridFrame(parent, child);
    return;
  }
  const margin = getBox(style, 'margin');
  const hasMargin = margin.top || margin.right || margin.bottom || margin.left;
  const parentFrame = parent as FrameNode;
  const isAutoLayout = parentFrame.layoutMode !== 'NONE';
  
  if (isAutoLayout && hasMargin) {
    const wrap = figma.createFrame();
    wrap.name = 'margin';
    wrap.fills = [];
    wrap.layoutMode = 'VERTICAL';
    wrap.primaryAxisSizingMode = 'AUTO';
    wrap.counterAxisSizingMode = 'AUTO';
    wrap.paddingTop = margin.top;
    wrap.paddingRight = margin.right;
    wrap.paddingBottom = margin.bottom;
    wrap.paddingLeft = margin.left;
    parentFrame.appendChild(wrap);
    wrap.appendChild(child);
    
    // Make margin wrapper fill width
    wrap.layoutSizingHorizontal = 'FILL';
    
    // Make inner child fill the wrapper
    if (child.type === 'FRAME') {
      child.layoutSizingHorizontal = 'FILL';
    }
    return;
  }
  parentFrame.appendChild(child);
}


type RendererContext = {
  renderNodes: (nodes: JsonNode[], parent: FrameNode) => Promise<void>;
  waitForPending: () => Promise<void>;
};

function createRendererContext(importOptions: ImportMessage['options'] | undefined, idToNode: Map<string, SceneNode>, pendingFills: Promise<void>[]): RendererContext {
  let created = 0;
  const CHUNK = 300;
  const opts = importOptions || {};

  const registerNodeRef = (nodeId: string | undefined, node: SceneNode) => {
    if (nodeId) idToNode.set(nodeId, node);
  };

  const maybeYield = async () => {
    if (created && created % CHUNK === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  const getNodeId = (el: ElementNode): string | undefined => {
    const idValue = (el.style as any)['--node-id'];
    return idValue === undefined ? undefined : String(idValue);
  };

  const queuePrototypeLink = (node: TextNode, el: ElementNode) => {
    if (!opts.prototypeLinks) return;
    const targetHref = el.attrs?.href;
    if (!targetHref?.startsWith('#')) return;
    (node as any).__pendingTargetId = targetHref.slice(1);
  };

  async function renderPlainTextNode(json: Extract<JsonNode, { kind: 'text' }>, parent: FrameNode, inheritedStyle?: Record<string, string>) {
    const textNode = figma.createText();
    const style = inheritedStyle || {};
    
    // Load the font based on inherited style or use Inter as fallback
    const family = resolveFontFamily(style);
    const styleName = resolveFontStyleName(style);
    const alias = fontAliasMap.get(`${family}__${styleName}`);
    const fontToUse = alias ?? fontNameOf(family, styleName);
    try {
      await figma.loadFontAsync(fontToUse);
      textNode.fontName = fontToUse;
    } catch {
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      textNode.fontName = { family: 'Inter', style: 'Regular' };
    }
    
    textNode.characters = json.text;
    
    // Apply inherited text styles (font-size, color, etc.)
    if (Object.keys(style).length > 0) {
      applyTextStyle(textNode, style);
    }
    
    // Ensure text doesn't get truncated
    textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
    
    appendWithMargin(parent, textNode, style, opts);
    created++;
  }

  async function renderHeading(el: ElementNode, parent: FrameNode, nodeId: string | undefined, tag: string) {
    const textNode = figma.createText();
    if (!el.style['font-weight']) el.style['font-weight'] = '700';
    
    // Load the font first
    const family = resolveFontFamily(el.style);
    const styleName = resolveFontStyleName(el.style);
    const alias = fontAliasMap.get(`${family}__${styleName}`);
    const fontToUse = alias ?? fontNameOf(family, styleName);
    try {
      await figma.loadFontAsync(fontToUse);
      textNode.fontName = fontToUse;
    } catch {
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      textNode.fontName = { family: 'Inter', style: 'Regular' };
    }
    
    textNode.characters = childrenText(el.children) || tag.toUpperCase();
    // Set default heading size, but applyTextStyle will override if font-size is in style
    textNode.fontSize = HEADING_SIZES[tag] || 16;
    applyTextStyle(textNode, el.style);
    
    // Ensure text doesn't get truncated
    textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
    
    appendWithMargin(parent, textNode, el.style, opts);
    registerNodeRef(nodeId, textNode);
    created++;
  }

  async function renderInlineText(el: ElementNode, parent: FrameNode, nodeId: string | undefined, tag: string) {
    const textNode = figma.createText();
    let textContent = childrenText(el.children);
    if (tag === 'li' && !textContent) {
      textContent = '•';
    }
    if (tag === 'a' && el.attrs?.href) {
      textNode.name = `link: ${el.attrs.href}`;
      if (!el.style['text-decoration']) el.style['text-decoration'] = 'underline';
    }
    
    // Load the font first
    const family = resolveFontFamily(el.style);
    const styleName = resolveFontStyleName(el.style);
    const alias = fontAliasMap.get(`${family}__${styleName}`);
    const fontToUse = alias ?? fontNameOf(family, styleName);
    try {
      await figma.loadFontAsync(fontToUse);
      textNode.fontName = fontToUse;
    } catch {
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      textNode.fontName = { family: 'Inter', style: 'Regular' };
    }
    
    textNode.characters = textContent;
    applyTextStyle(textNode, el.style);
    
    // Ensure text doesn't get truncated - set auto width
    textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
    
    appendWithMargin(parent, textNode, el.style, opts);
    registerNodeRef(nodeId, textNode);
    if (tag === 'a') {
      queuePrototypeLink(textNode, el);
    }
    created++;
  }

  async function renderListContainer(el: ElementNode, parent: FrameNode, nodeId: string | undefined) {
    const frame = figma.createFrame();
    frame.name = el.tag;
    applyFrameBoxStyle(frame, el.style, { autoLayout: true }, pendingFills);
    frame.itemSpacing = 4;
    appendWithMargin(parent, frame, el.style, opts);
    
    // Set fill width for list containers
    if (parent.layoutMode !== 'NONE') {
      frame.layoutSizingHorizontal = 'FILL';
    }
    
    registerNodeRef(nodeId, frame);
    created++;
    await renderNodes(el.children || [], frame, el.style);
  }

  async function renderButtonElement(el: ElementNode, parent: FrameNode, nodeId: string | undefined) {
    const frame = figma.createFrame();
    frame.name = el.tag;
    applyFrameBoxStyle(frame, el.style, { autoLayout: true }, pendingFills);
    
    // Get button text
    const buttonText = childrenText(el.children) || el.attrs?.value || '';
    if (buttonText) {
      const textNode = figma.createText();
      
      // Load the font first
      const family = resolveFontFamily(el.style);
      const styleName = resolveFontStyleName(el.style);
      const alias = fontAliasMap.get(`${family}__${styleName}`);
      const fontToUse = alias ?? fontNameOf(family, styleName);
      try {
        await figma.loadFontAsync(fontToUse);
        textNode.fontName = fontToUse;
      } catch {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        textNode.fontName = { family: 'Inter', style: 'Regular' };
      }
      
      textNode.characters = buttonText;
      applyTextStyle(textNode, el.style);
      frame.appendChild(textNode);
    }
    
    appendWithMargin(parent, frame, el.style, opts);
    registerNodeRef(nodeId, frame);
    created++;
  }

  function renderImageElement(el: ElementNode, parent: FrameNode, nodeId: string | undefined) {
    const rect = figma.createRectangle();
    rect.resize(200, 120);
    rect.name = el.attrs?.alt ? `img: ${el.attrs.alt}` : 'image';
    const width = parsePx(el.style['width']);
    const height = parsePx(el.style['height']);
    if (width || height) rect.resize(width ?? rect.width, height ?? rect.height);
    applyBorder(rect, el.style);
    applyBoxShadow(rect, el.style);
    const opacity = parseNumber(el.style['opacity']);
    if (opacity !== undefined) rect.opacity = Math.max(0, Math.min(1, opacity));
    appendWithMargin(parent, rect, el.style, opts);
    registerNodeRef(nodeId, rect);
    created++;
    scheduleImageFill(rect, el.attrs?.src, pendingFills, el.style);
  }

  async function renderGenericFrame(el: ElementNode, parent: FrameNode, nodeId: string | undefined) {
    const frame = figma.createFrame();
    frame.name = el.attrs?.id ? el.attrs.id : el.tag;
    applyFrameBoxStyle(frame, el.style, { autoLayout: !!opts.autoLayout }, pendingFills);
    
    appendWithMargin(parent, frame, el.style, opts);
    
    // After adding to parent, set proper layout sizing
    const explicitWidth = parsePx(el.style['width']);
    const explicitHeight = parsePx(el.style['height']) ?? parsePx(el.style['min-height']);
    
    if (parent.layoutMode !== 'NONE') {
      if (explicitWidth !== undefined) {
        frame.layoutSizingHorizontal = 'FIXED';
        // Re-apply width after adding to parent
        frame.resize(explicitWidth, frame.height);
      } else {
        // Check if this looks like a container that should fill width
        const display = (el.style['display'] || '').toLowerCase();
        if (display === 'block' || display === 'flex' || display === 'grid' || display === '') {
          frame.layoutSizingHorizontal = 'FILL';
        } else {
          frame.layoutSizingHorizontal = 'HUG';
        }
      }
      
      if (explicitHeight !== undefined) {
        frame.layoutSizingVertical = 'FIXED';
        frame.resize(frame.width, explicitHeight);
      } else {
        // Default to HUG for vertical sizing to prevent content clipping
        frame.layoutSizingVertical = 'HUG';
      }
    }
    
    registerNodeRef(nodeId, frame);
    created++;
    // Pass parent element's style to children for text node inheritance
    await renderNodes(el.children || [], frame, el.style);
  }

  function renderSvgElement(el: ElementNode, parent: FrameNode, nodeId: string | undefined) {
    // Reconstruct SVG string from the element
    const svgString = reconstructSvgString(el);
    if (!svgString) {
      // Fallback: create a placeholder frame
      const placeholder = figma.createFrame();
      placeholder.name = 'svg';
      placeholder.resize(24, 24);
      placeholder.fills = [];
      appendWithMargin(parent, placeholder, el.style, opts);
      registerNodeRef(nodeId, placeholder);
      created++;
      return;
    }
    try {
      const svgNode = figma.createNodeFromSvg(svgString);
      svgNode.name = 'icon';
      // Apply sizing from style if available
      const width = parsePx(el.style['width']) || parsePx(el.attrs?.width + 'px');
      const height = parsePx(el.style['height']) || parsePx(el.attrs?.height + 'px');
      if (width && height) {
        svgNode.resize(width, height);
      }
      appendWithMargin(parent, svgNode, el.style, opts);
      registerNodeRef(nodeId, svgNode);
      created++;
    } catch (error) {
      console.warn('Failed to create SVG node:', error);
      // Fallback: create a placeholder
      const placeholder = figma.createFrame();
      placeholder.name = 'svg-error';
      placeholder.resize(24, 24);
      placeholder.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
      appendWithMargin(parent, placeholder, el.style, opts);
      registerNodeRef(nodeId, placeholder);
      created++;
    }
  }

  async function renderElement(el: ElementNode, parent: FrameNode) {
    const tag = el.tag.toLowerCase();
    const nodeId = getNodeId(el);
    if (HEADING_TAGS.has(tag)) {
      await renderHeading(el, parent, nodeId, tag);
      return;
    }
    if (INLINE_TEXT_TAGS.has(tag)) {
      await renderInlineText(el, parent, nodeId, tag);
      return;
    }
    if (LIST_CONTAINER_TAGS.has(tag)) {
      await renderListContainer(el, parent, nodeId);
      return;
    }
    if (tag === 'img') {
      renderImageElement(el, parent, nodeId);
      return;
    }
    if (BUTTON_TAGS.has(tag)) {
      await renderButtonElement(el, parent, nodeId);
      return;
    }
    if (tag === 'svg') {
      renderSvgElement(el, parent, nodeId);
      return;
    }
    // Skip SVG child elements (they're handled by the parent svg element)
    if (SVG_TAGS.has(tag)) {
      return;
    }
    await renderGenericFrame(el, parent, nodeId);
  }

  async function renderNodes(nodes: JsonNode[], parent: FrameNode, parentStyle?: Record<string, string>) {
    for (const node of nodes) {
      await maybeYield();
      if ((node as any).kind === 'text') {
        await renderPlainTextNode(node as Extract<JsonNode, { kind: 'text' }>, parent, parentStyle);
      } else {
        await renderElement(node as ElementNode, parent);
      }
    }
  }

  const waitForPending = async () => {
    if (!pendingFills.length) return;
    await Promise.all(pendingFills.map((task) => task.catch(() => undefined)));
  };

  return { renderNodes, waitForPending };
}

function createRootFrame(viewport?: { width: number; height: number }): FrameNode {
  const frame = figma.createFrame();
  frame.name = 'Imported HTML';
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'FIXED';
  // Use viewport width if provided, otherwise default to 1920
  const frameWidth = viewport?.width || 1920;
  frame.resize(frameWidth, 100);
  frame.paddingTop = 32;
  frame.paddingRight = 40;
  frame.paddingBottom = 32;
  frame.paddingLeft = 40;
  frame.itemSpacing = 32; // Match mb-8 (32px) spacing between sections
  frame.fills = [{ type: 'SOLID', color: { r: 0.957, g: 0.969, b: 0.996 } }]; // #F4F7FE background
  frame.clipsContent = false;
  figma.currentPage.appendChild(frame);
  return frame;
}

function resolvePrototypeLinksForPage(options: ImportMessage['options'] | undefined, idToNode: Map<string, SceneNode>) {
  if (!options?.prototypeLinks) return;
  const allNodes = figma.currentPage.findAll();
  const byName = new Map(allNodes.map((node) => [node.name, node]));
  for (const node of allNodes) {
    const pendingId = (node as any).__pendingTargetId as string | undefined;
    if (!pendingId) continue;
    delete (node as any).__pendingTargetId;
    const destination = idToNode.get(pendingId) || byName.get(pendingId);
    if (destination && 'reactions' in node) {
      (node as any).reactions = [
        {
          action: { type: 'NODE', destinationId: destination.id, navigation: 'NAVIGATE', transition: null, preserveScrollPosition: false },
          trigger: { type: 'ON_CLICK' }
        }
      ];
    }
  }
}

async function createLocalStylesFromDocument(): Promise<void> {
  const colorSet = new Map<string, PaintStyle>();
  const sizeSet = new Map<number, TextStyle>();
  for (const node of figma.currentPage.findAll()) {
    if (node.type !== 'TEXT') continue;
    
    // Load the font before accessing font-dependent properties
    try {
      const fontName = node.fontName;
      if (fontName && typeof fontName === 'object' && 'family' in fontName) {
        await figma.loadFontAsync(fontName as FontName);
      }
    } catch {
      // Skip if font can't be loaded
      continue;
    }
    
    if (typeof node.fontSize === 'number' && !sizeSet.has(node.fontSize)) {
      const textStyle = figma.createTextStyle();
      textStyle.name = `Text/${node.fontSize}`;
      textStyle.fontSize = node.fontSize;
      sizeSet.set(node.fontSize, textStyle);
      try {
        await node.setTextStyleIdAsync(textStyle.id);
      } catch {
        // Ignore style setting errors
      }
    }
    const fills = Array.isArray(node.fills) ? node.fills : [];
    const solid = fills.find((paint): paint is SolidPaint => paint.type === 'SOLID');
    if (!solid) continue;
    const colorKey = hexOf(solid.color);
    let paintStyle = colorSet.get(colorKey);
    if (!paintStyle) {
      paintStyle = figma.createPaintStyle();
      paintStyle.name = `Color/${colorKey}`;
      paintStyle.paints = [{ type: 'SOLID', color: solid.color }];
      colorSet.set(colorKey, paintStyle);
    }
    try {
      await node.setFillStyleIdAsync(paintStyle.id);
    } catch {
      // Ignore style setting errors
    }
  }
}

import uiHtml from './ui.html';
figma.showUI(uiHtml, { width: 520, height: 480 });

function isUiErrorMessage(msg: ImportMessage | UiErrorMessage): msg is UiErrorMessage {
  return msg.type === 'error';
}

async function handleMessage(raw: ImportMessage | UiErrorMessage) {
  if (isUiErrorMessage(raw)) {
    figma.notify(raw.message || 'Error from UI');
    return;
  }
  if (raw.type !== 'import-html') return;
  await processImportMessage(raw);
}

async function processImportMessage(msg: ImportMessage) {
  const opts = msg.options || {};

  console.log('Received payload:', JSON.stringify(msg.payload, null, 2));

  const { missing, substitutions } = await prepareFontsForPayload(msg.payload || []);
  if (missing.length) {
    figma.ui.postMessage({ type: 'missing-fonts', fonts: missing });
  }
  if (substitutions.length) {
    figma.ui.postMessage({ type: 'font-substitutions', items: substitutions });
  }

  const frame = createRootFrame(opts.viewport);

  const idToNode = new Map<string, SceneNode>();
  const pendingFills: Promise<void>[] = [];
  const renderer = createRendererContext(opts, idToNode, pendingFills);
  await renderer.renderNodes(msg.payload || [], frame);
  await renderer.waitForPending();

  resolvePrototypeLinksForPage(opts, idToNode);

  if (opts.createStyles) {
    await createLocalStylesFromDocument();
  }
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  figma.ui.postMessage({ type: 'done' });
}

figma.ui.onmessage = (raw: ImportMessage | UiErrorMessage) => {
  void handleMessage(raw);
};
