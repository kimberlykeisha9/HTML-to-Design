import {
  parsePx,
  parseNumber,
  stripQuotes,
  resolveFontStyleName,
  resolveFontFamily,
  extractImageReference,
  parseColorWithAlpha,
} from '../code';

describe('code helpers', () => {
  describe('parsePx', () => {
    it('parses px values and ignores invalid strings', () => {
      expect(parsePx('16px')).toBe(16);
      expect(parsePx('  4.5px ')).toBe(4.5);
      expect(parsePx('auto')).toBeUndefined();
    });
  });

  describe('parseNumber', () => {
    it('returns numbers when valid', () => {
      expect(parseNumber(' 42 ')).toBe(42);
      expect(parseNumber('3.14')).toBeCloseTo(3.14);
      expect(parseNumber('')).toBeUndefined();
    });
  });

  describe('stripQuotes', () => {
    it('removes surrounding quotes', () => {
      expect(stripQuotes("'hello'")).toBe('hello');
      expect(stripQuotes('"world"')).toBe('world');
      expect(stripQuotes('no-quotes')).toBe('no-quotes');
    });
  });

  describe('resolveFontFamily', () => {
    it('returns the first non-empty family', () => {
      const style = { 'font-family': "'Inter', 'Roboto', sans-serif" };
      expect(resolveFontFamily(style)).toBe('Inter');
    });
    it('falls back to Inter when empty', () => {
      expect(resolveFontFamily({})).toBe('Inter');
    });
  });

  describe('resolveFontStyleName', () => {
    it('returns Regular by default', () => {
      expect(resolveFontStyleName({})).toBe('Regular');
    });
    it('detects bold/italic combinations', () => {
      expect(resolveFontStyleName({ 'font-weight': 'bold', 'font-style': 'italic' })).toBe('Bold Italic');
      expect(resolveFontStyleName({ 'font-weight': '900' })).toBe('Bold');
    });
  });

  describe('extractImageReference', () => {
    it('returns URL when present', () => {
      const src = extractImageReference('url("https://example.com/a.png")');
      expect(src).toBe('https://example.com/a.png');
    });
    it('returns null when absent', () => {
      expect(extractImageReference('none')).toBeNull();
    });
  });

  describe('parseColorWithAlpha', () => {
    it('handles transparent keyword', () => {
      expect(parseColorWithAlpha('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });
    it('parses RGBA values', () => {
      expect(parseColorWithAlpha('rgba(255, 0, 0, 0.5)')).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
    });
    it('parses rgb with slash alpha', () => {
      expect(parseColorWithAlpha('rgb(0 255 0 / 25%)')).toEqual({ r: 0, g: 1, b: 0, a: 0.25 });
    });
  });
});
