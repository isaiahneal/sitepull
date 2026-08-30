export interface ComputedStyleSample {
  readonly route?: string;
  readonly tag?: string;
  readonly role?: string | null;
  readonly styles: Readonly<Record<string, string | null | undefined>>;
}

export interface FrequencyToken {
  readonly value: string;
  readonly count: number;
  readonly properties: readonly string[];
}

export interface TypographyToken {
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly letterSpacing: string;
  readonly count: number;
  readonly tags: readonly string[];
}

export interface DesignTokenAnalysis {
  readonly colors: readonly FrequencyToken[];
  readonly typography: readonly TypographyToken[];
  readonly spacing: readonly FrequencyToken[];
  readonly radii: readonly FrequencyToken[];
  readonly shadows: readonly FrequencyToken[];
}

interface RgbaColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

interface MutableFrequency {
  count: number;
  readonly properties: Set<string>;
}

interface MutableTypography {
  count: number;
  readonly tags: Set<string>;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly letterSpacing: string;
}

const BASIC_NAMED_COLORS: Readonly<Record<string, string>> = {
  aqua: '#00ffff',
  black: '#000000',
  blue: '#0000ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  green: '#008000',
  grey: '#808080',
  lime: '#00ff00',
  maroon: '#800000',
  navy: '#000080',
  olive: '#808000',
  orange: '#ffa500',
  purple: '#800080',
  red: '#ff0000',
  silver: '#c0c0c0',
  teal: '#008080',
  white: '#ffffff',
  yellow: '#ffff00',
};

const NON_TOKEN_COLOR_KEYWORDS = new Set([
  'currentcolor',
  'inherit',
  'initial',
  'none',
  'revert',
  'revert-layer',
  'unset',
]);

const COLOR_PROPERTIES = [
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'fill',
  'stroke',
] as const;

const SPACING_PROPERTIES = [
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
  'gap',
  'row-gap',
  'column-gap',
] as const;

const RADIUS_PROPERTIES = [
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
] as const;

const STYLE_ALIASES: Readonly<Record<string, string>> = {
  'background-color': 'backgroundColor',
  'border-color': 'borderColor',
  'border-top-color': 'borderTopColor',
  'border-right-color': 'borderRightColor',
  'border-bottom-color': 'borderBottomColor',
  'border-left-color': 'borderLeftColor',
  'outline-color': 'outlineColor',
  'text-decoration-color': 'textDecorationColor',
  'margin-top': 'marginTop',
  'margin-right': 'marginRight',
  'margin-bottom': 'marginBottom',
  'margin-left': 'marginLeft',
  'padding-top': 'paddingTop',
  'padding-right': 'paddingRight',
  'padding-bottom': 'paddingBottom',
  'padding-left': 'paddingLeft',
  'row-gap': 'rowGap',
  'column-gap': 'columnGap',
  'border-radius': 'borderRadius',
  'border-top-left-radius': 'borderTopLeftRadius',
  'border-top-right-radius': 'borderTopRightRadius',
  'border-bottom-right-radius': 'borderBottomRightRadius',
  'border-bottom-left-radius': 'borderBottomLeftRadius',
  'box-shadow': 'boxShadow',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'line-height': 'lineHeight',
  'letter-spacing': 'letterSpacing',
};

function styleValue(sample: ComputedStyleSample, property: string): string | undefined {
  const direct = sample.styles[property];
  const alias = STYLE_ALIASES[property];
  const value = direct ?? (alias === undefined ? undefined : sample.styles[alias]);
  const normalized = value?.trim();
  return normalized === '' ? undefined : normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseHexColor(value: string): RgbaColor | undefined {
  const match = /^#([a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.exec(value);
  const digits = match?.[1];
  if (digits === undefined) return undefined;

  const expanded =
    digits.length <= 4 ? [...digits].map((digit) => `${digit}${digit}`).join('') : digits;
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
    alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  };
}

function parseAlpha(value: string | undefined): number | undefined {
  if (value === undefined) return 1;
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return undefined;
  return clamp(value.trim().endsWith('%') ? number / 100 : number, 0, 1);
}

function parseRgbChannel(value: string): number | undefined {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return undefined;
  const scaled = value.trim().endsWith('%') ? (number / 100) * 255 : number;
  return Math.round(clamp(scaled, 0, 255));
}

function functionalParts(body: string): { channels: readonly string[]; alpha?: string } {
  if (body.includes(',')) {
    const parts = body.split(',').map((part) => part.trim());
    return parts[3] === undefined
      ? { channels: parts.slice(0, 3) }
      : { channels: parts.slice(0, 3), alpha: parts[3] };
  }

  const [channelSection = '', alphaSection] = body.split('/', 2).map((part) => part.trim());
  const channels = channelSection.split(/\s+/).filter((part) => part !== '');
  return alphaSection === undefined ? { channels } : { channels, alpha: alphaSection };
}

function parseRgbColor(value: string): RgbaColor | undefined {
  const match = /^rgba?\((.*)\)$/i.exec(value);
  if (match?.[1] === undefined) return undefined;
  const parts = functionalParts(match[1]);
  if (parts.channels.length !== 3) return undefined;

  const red = parseRgbChannel(parts.channels[0] ?? '');
  const green = parseRgbChannel(parts.channels[1] ?? '');
  const blue = parseRgbChannel(parts.channels[2] ?? '');
  const alpha = parseAlpha(parts.alpha);
  if (red === undefined || green === undefined || blue === undefined || alpha === undefined)
    return undefined;
  return { red, green, blue, alpha };
}

function parseHue(value: string): number | undefined {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return undefined;
  let degrees = number;
  if (value.endsWith('turn')) degrees = number * 360;
  else if (value.endsWith('grad')) degrees = number * 0.9;
  else if (value.endsWith('rad')) degrees = number * (180 / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

function parsePercentage(value: string): number | undefined {
  if (!value.trim().endsWith('%')) return undefined;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? clamp(number / 100, 0, 1) : undefined;
}

function hueToRgb(p: number, q: number, input: number): number {
  let hue = input;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function parseHslColor(value: string): RgbaColor | undefined {
  const match = /^hsla?\((.*)\)$/i.exec(value);
  if (match?.[1] === undefined) return undefined;
  const parts = functionalParts(match[1]);
  if (parts.channels.length !== 3) return undefined;

  const hue = parseHue(parts.channels[0] ?? '');
  const saturation = parsePercentage(parts.channels[1] ?? '');
  const lightness = parsePercentage(parts.channels[2] ?? '');
  const alpha = parseAlpha(parts.alpha);
  if (
    hue === undefined ||
    saturation === undefined ||
    lightness === undefined ||
    alpha === undefined
  )
    return undefined;

  if (saturation === 0) {
    const channel = Math.round(lightness * 255);
    return { red: channel, green: channel, blue: channel, alpha };
  }

  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const normalizedHue = hue / 360;
  return {
    red: Math.round(hueToRgb(p, q, normalizedHue + 1 / 3) * 255),
    green: Math.round(hueToRgb(p, q, normalizedHue) * 255),
    blue: Math.round(hueToRgb(p, q, normalizedHue - 1 / 3) * 255),
    alpha,
  };
}

function formatAlpha(alpha: number): string {
  return Number(alpha.toFixed(3)).toString();
}

function formatColor(color: RgbaColor): string {
  if (color.alpha >= 0.9995) {
    return `#${[color.red, color.green, color.blue]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${formatAlpha(color.alpha)})`;
}

/** Normalizes common equivalent CSS color forms while preserving newer color spaces verbatim. */
export function normalizeCssColor(input: string): string | undefined {
  const value = input.trim().toLowerCase();
  if (value === '' || NON_TOKEN_COLOR_KEYWORDS.has(value)) return undefined;
  if (value === 'transparent') return 'rgba(0, 0, 0, 0)';

  const named = BASIC_NAMED_COLORS[value];
  const parsed = parseHexColor(named ?? value) ?? parseRgbColor(value) ?? parseHslColor(value);
  if (parsed !== undefined) return formatColor(parsed);

  if (/^(?:color|lab|lch|oklab|oklch)\(/.test(value)) {
    return value.replace(/\s+/g, ' ');
  }
  if (/^[a-z]+$/.test(value)) {
    return value;
  }
  return undefined;
}

function incrementFrequency(
  frequencies: Map<string, MutableFrequency>,
  value: string,
  property: string,
): void {
  const existing = frequencies.get(value);
  if (existing === undefined) {
    frequencies.set(value, { count: 1, properties: new Set([property]) });
    return;
  }
  existing.count += 1;
  existing.properties.add(property);
}

function sortedFrequencies(frequencies: ReadonlyMap<string, MutableFrequency>): FrequencyToken[] {
  return [...frequencies.entries()]
    .map(([value, frequency]) => ({
      value,
      count: frequency.count,
      properties: [...frequency.properties].sort(),
    }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

export function aggregateColors(samples: readonly ComputedStyleSample[]): FrequencyToken[] {
  const frequencies = new Map<string, MutableFrequency>();
  for (const sample of samples) {
    for (const property of COLOR_PROPERTIES) {
      const raw = styleValue(sample, property);
      const normalized = raw === undefined ? undefined : normalizeCssColor(raw);
      if (normalized !== undefined) incrementFrequency(frequencies, normalized, property);
    }
  }
  return sortedFrequencies(frequencies);
}

function normalizeCssValue(value: string | undefined, fallback: string): string {
  return value?.replace(/\s+/g, ' ').trim() || fallback;
}

export function aggregateTypography(samples: readonly ComputedStyleSample[]): TypographyToken[] {
  const frequencies = new Map<string, MutableTypography>();
  for (const sample of samples) {
    const capturedFontFamily = styleValue(sample, 'font-family');
    const capturedFontSize = styleValue(sample, 'font-size');
    if (capturedFontFamily === undefined || capturedFontSize === undefined) continue;
    const fontFamily = normalizeCssValue(capturedFontFamily, '');
    const fontSize = normalizeCssValue(capturedFontSize, '');
    const fontWeight = normalizeCssValue(styleValue(sample, 'font-weight'), '');
    const lineHeight = normalizeCssValue(styleValue(sample, 'line-height'), '');
    const letterSpacing = normalizeCssValue(styleValue(sample, 'letter-spacing'), '');
    const key = JSON.stringify([fontFamily, fontSize, fontWeight, lineHeight, letterSpacing]);
    const existing = frequencies.get(key);
    if (existing === undefined) {
      frequencies.set(key, {
        fontFamily,
        fontSize,
        fontWeight,
        lineHeight,
        letterSpacing,
        count: 1,
        tags: new Set(sample.tag === undefined ? [] : [sample.tag.toLowerCase()]),
      });
    } else {
      existing.count += 1;
      if (sample.tag !== undefined) existing.tags.add(sample.tag.toLowerCase());
    }
  }

  return [...frequencies.values()]
    .map((token) => ({
      fontFamily: token.fontFamily,
      fontSize: token.fontSize,
      fontWeight: token.fontWeight,
      lineHeight: token.lineHeight,
      letterSpacing: token.letterSpacing,
      count: token.count,
      tags: [...token.tags].sort(),
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.fontFamily.localeCompare(right.fontFamily) ||
        left.fontSize.localeCompare(right.fontSize),
    );
}

const CSS_LENGTH = /-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex)/gi;

function aggregateLengths(
  samples: readonly ComputedStyleSample[],
  properties: readonly string[],
): FrequencyToken[] {
  const frequencies = new Map<string, MutableFrequency>();
  for (const sample of samples) {
    for (const property of properties) {
      const value = styleValue(sample, property);
      if (value === undefined || value === 'normal' || value === 'none') continue;
      const lengths = new Set(value.match(CSS_LENGTH)?.map((length) => length.toLowerCase()) ?? []);
      for (const length of lengths) incrementFrequency(frequencies, length, property);
    }
  }
  return sortedFrequencies(frequencies);
}

export function aggregateSpacing(samples: readonly ComputedStyleSample[]): FrequencyToken[] {
  return aggregateLengths(samples, SPACING_PROPERTIES);
}

export function aggregateRadii(samples: readonly ComputedStyleSample[]): FrequencyToken[] {
  return aggregateLengths(samples, RADIUS_PROPERTIES);
}

export function aggregateShadows(samples: readonly ComputedStyleSample[]): FrequencyToken[] {
  const frequencies = new Map<string, MutableFrequency>();
  for (const sample of samples) {
    const value = styleValue(sample, 'box-shadow');
    if (value === undefined || value.toLowerCase() === 'none') continue;
    incrementFrequency(frequencies, value.replace(/\s+/g, ' '), 'box-shadow');
  }
  return sortedFrequencies(frequencies);
}

export function aggregateDesignTokens(
  samples: readonly ComputedStyleSample[],
): DesignTokenAnalysis {
  return {
    colors: aggregateColors(samples),
    typography: aggregateTypography(samples),
    spacing: aggregateSpacing(samples),
    radii: aggregateRadii(samples),
    shadows: aggregateShadows(samples),
  };
}
