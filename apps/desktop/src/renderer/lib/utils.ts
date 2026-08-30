import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { normalizeHttpUrlInput, type NormalizedHttpUrlInput } from '@sitepull/contracts';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, compact = false): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  const digits = compact || value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function captureElapsedMs(
  startedAt: number | null,
  eventElapsedMs: number,
  now: number,
): number {
  const liveElapsed = startedAt === null || now <= 0 ? 0 : now - startedAt;
  return Math.max(0, eventElapsedMs, liveElapsed);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function relativeTime(isoDate: string): string {
  const elapsed = Date.now() - new Date(isoDate).getTime();
  const absolute = Math.abs(elapsed);
  if (absolute < 45_000) return 'just now';
  const units: Array<readonly [Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['week', 604_800_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const selected = units.find(([, duration]) => absolute >= duration) ?? units[units.length - 1];
  if (!selected) return 'just now';
  return formatter.format(Math.round(-elapsed / selected[1]), selected[0]);
}

export function normalizeUrlRequestInput(input: string): NormalizedHttpUrlInput {
  try {
    return normalizeHttpUrlInput(input);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Enter a valid HTTP or HTTPS website URL.',
      { cause: error },
    );
  }
}

export function normalizeUrlInput(input: string): string {
  return normalizeUrlRequestInput(input).url;
}

/** URL understood by the main-process read-only capture protocol handler. */
export function captureFileUrl(captureId: string, relativePath: string): string {
  const safeCaptureId = encodeURIComponent(captureId);
  const safePath = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `sitepull-capture://capture/${safeCaptureId}/${safePath}`;
}

export function isCaptureScreenshotPath(relativePath: string): boolean {
  return /^pages\/[A-Za-z0-9][A-Za-z0-9._-]*\/screenshots\/[A-Za-z0-9][A-Za-z0-9._-]*\.png$/u.test(
    relativePath,
  );
}

export function getFileExtension(path: string): string {
  const file = path.split('/').at(-1) ?? '';
  const index = file.lastIndexOf('.');
  return index > 0 ? file.slice(index + 1).toLowerCase() : '';
}

export function isTextPreviewable(path: string): boolean {
  return new Set([
    'css',
    'html',
    'js',
    'json',
    'jsonl',
    'map',
    'md',
    'mjs',
    'svg',
    'txt',
    'xml',
    'yaml',
    'yml',
  ]).has(getFileExtension(path));
}

export function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split('/').filter(Boolean).at(-1) ?? parsed.hostname;
  } catch {
    return url;
  }
}

export function readableStage(stage: string): string {
  return stage
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function safeCssColor(value: string): string {
  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    candidate.length > 160 ||
    /[;{}]|url\s*\(|var\s*\(/iu.test(candidate)
  ) {
    return 'transparent';
  }
  if (['inherit', 'initial', 'revert', 'revert-layer', 'unset'].includes(candidate.toLowerCase())) {
    return 'transparent';
  }
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    return CSS.supports('color', candidate) ? candidate : 'transparent';
  }
  if (/^#[0-9a-f]{3,8}$/iu.test(candidate)) return candidate;
  if (
    /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklch|oklab|color)\([a-z\d\s.,%+\-/]+\)$/iu.test(candidate)
  )
    return candidate;
  if (/^[a-z]{3,20}$/iu.test(candidate)) return candidate;
  return 'transparent';
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.readOnly = true;
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-10000px';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard access is unavailable.');
  }
}
