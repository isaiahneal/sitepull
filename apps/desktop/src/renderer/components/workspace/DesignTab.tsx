import type { CaptureManifest, ColorToken, MeasurementToken } from '@sitepull/contracts';
import { Braces, CircleDot, Copy, Grid2X2, Layers3, Palette, Sparkles, Type } from 'lucide-react';
import { useState } from 'react';

import { copyText, formatCount, safeCssColor } from '../../lib/utils.js';
import { EmptyPanel, SectionHeading, WorkspacePanel } from './shared.js';

export function DesignTab({ manifest }: { readonly manifest: CaptureManifest }) {
  const design = manifest.design;
  return (
    <div className="grid gap-5 pb-8">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
        <WorkspacePanel className="p-4">
          <SectionHeading
            eyebrow="Color system"
            title="Observed palette"
            aside={<span className="text-[10px] text-zinc-650">Ranked by frequency</span>}
          />
          {design.colors.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {design.colors.slice(0, 24).map((color) => (
                <ColorSwatch
                  key={`${color.normalizedValue}-${color.inferredRole ?? ''}`}
                  color={color}
                />
              ))}
            </div>
          ) : (
            <EmptyPanel
              icon={Palette}
              title="No color tokens"
              detail="No repeated computed colors were available for this capture."
            />
          )}
        </WorkspacePanel>

        <WorkspacePanel className="p-4">
          <SectionHeading
            eyebrow="Scale"
            title="Spacing rhythm"
            aside={<Grid2X2 className="size-3.5 text-zinc-650" />}
          />
          <div className="mt-5 space-y-2.5">
            {design.spacing.slice(0, 16).map((token, index) => (
              <SpacingRow
                key={`${token.value}-${index}`}
                token={token}
                maxPixels={maxMeasurement(design.spacing)}
              />
            ))}
          </div>
          <div className="mt-6 border-t border-white/[0.06] pt-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-650">
              Likely base increment
            </p>
            <p className="mt-2 text-[20px] font-semibold tracking-[-0.04em] text-zinc-200">
              {inferBaseIncrement(design.spacing)}
            </p>
            <p className="mt-1 text-[10px] text-zinc-650">
              Derived from recurring pixel measurements
            </p>
          </div>
        </WorkspacePanel>
      </div>

      <WorkspacePanel className="overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-3">
          <SectionHeading
            eyebrow="Typography"
            title="Type hierarchy"
            aside={
              <span className="text-[10px] text-zinc-650">
                {design.typography.length} treatments
              </span>
            }
          />
        </div>
        {design.typography.length > 0 ? (
          <div className="divide-y divide-white/[0.055]">
            {design.typography.slice(0, 16).map((token, index) => {
              const size = Math.min(Math.max(Number.parseFloat(token.fontSize) || 14, 10), 56);
              const weight = /^\d{3}$/u.test(token.fontWeight) ? Number(token.fontWeight) : 400;
              return (
                <div
                  key={`${token.fontFamily}-${token.fontSize}-${token.fontWeight}-${index}`}
                  className="grid gap-4 px-4 py-4 md:grid-cols-[112px_minmax(0,1fr)_220px] md:items-center"
                >
                  <div>
                    <span className="rounded border border-blue-400/15 bg-blue-400/[0.06] px-1.5 py-1 text-[9px] font-medium capitalize text-blue-300/80">
                      {token.inferredRole ?? `Treatment ${index + 1}`}
                    </span>
                    <p className="mt-2 text-[9px] text-zinc-700">
                      {formatCount(token.occurrences)} uses
                    </p>
                  </div>
                  <p
                    className="min-w-0 truncate text-zinc-200"
                    style={{
                      fontFamily: token.fontFamily,
                      fontSize: `${size}px`,
                      fontWeight: weight,
                      lineHeight: 1.2,
                    }}
                  >
                    The quick brown fox jumps over the lazy dog.
                  </p>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[9px]">
                    <dt className="text-zinc-700">Family</dt>
                    <dd className="truncate text-zinc-500" title={token.fontFamily}>
                      {token.fontFamily}
                    </dd>
                    <dt className="text-zinc-700">Size / line</dt>
                    <dd className="text-zinc-500">
                      {token.fontSize} / {token.lineHeight}
                    </dd>
                    <dt className="text-zinc-700">Weight</dt>
                    <dd className="text-zinc-500">{token.fontWeight}</dd>
                    <dt className="text-zinc-700">Tracking</dt>
                    <dd className="text-zinc-500">{token.letterSpacing}</dd>
                  </dl>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyPanel
            icon={Type}
            title="No typography tokens"
            detail="The capture did not expose repeated computed type treatments."
          />
        )}
      </WorkspacePanel>

      <div className="grid gap-5 lg:grid-cols-2">
        <WorkspacePanel className="p-4">
          <SectionHeading
            eyebrow="Surfaces"
            title="Border radii"
            aside={<CircleDot className="size-3.5 text-zinc-650" />}
          />
          <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4">
            {design.radii.slice(0, 12).map((radius) => {
              const value = safeRadius(radius.value);
              return (
                <div key={radius.value} className="text-center">
                  <div
                    className="mx-auto grid aspect-square w-full max-w-[86px] place-items-center border border-blue-300/20 bg-gradient-to-br from-blue-400/[0.1] to-violet-400/[0.03]"
                    style={{ borderRadius: value }}
                  >
                    <span className="text-[9px] tabular-nums text-zinc-600">
                      {radius.occurrences}×
                    </span>
                  </div>
                  <p className="mt-2 truncate font-mono text-[9px] text-zinc-550">{radius.value}</p>
                </div>
              );
            })}
          </div>
        </WorkspacePanel>

        <WorkspacePanel className="p-4">
          <SectionHeading
            eyebrow="Elevation"
            title="Observed shadows"
            aside={<Layers3 className="size-3.5 text-zinc-650" />}
          />
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {design.shadows.slice(0, 9).map((shadow, index) => (
              <div key={`${shadow.value}-${index}`}>
                <div
                  className="aspect-[1.45] rounded-[10px] border border-white/[0.07] bg-[#18191e]"
                  style={{ boxShadow: safeShadow(shadow.value) }}
                />
                <p className="mt-2 line-clamp-2 font-mono text-[8px] leading-3 text-zinc-650">
                  {shadow.value}
                </p>
                <p className="mt-1 text-[8px] text-zinc-750">{shadow.occurrences} uses</p>
              </div>
            ))}
          </div>
        </WorkspacePanel>
      </div>

      <WorkspacePanel className="overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-3">
          <SectionHeading
            eyebrow="Source tokens"
            title="CSS custom properties"
            aside={<Braces className="size-3.5 text-zinc-650" />}
          />
        </div>
        {design.cssVariables.length > 0 ? (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full table-fixed text-left text-[10px]">
              <thead className="sticky top-0 bg-[#121318] text-[8px] font-semibold uppercase tracking-[0.1em] text-zinc-700">
                <tr>
                  <th className="w-[34%] px-4 py-2.5">Variable</th>
                  <th className="px-4 py-2.5">Values</th>
                  <th className="w-20 px-4 py-2.5 text-right">Uses</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05] font-mono">
                {design.cssVariables.map((variable) => (
                  <tr key={variable.name} className="group hover:bg-white/[0.02]">
                    <td className="truncate px-4 py-2.5 text-blue-300/80" title={variable.name}>
                      {variable.name}
                    </td>
                    <td
                      className="truncate px-4 py-2.5 text-zinc-500"
                      title={variable.values.join(', ')}
                    >
                      {variable.values.join(', ')}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                      {variable.occurrences}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel
            icon={Sparkles}
            title="No CSS variables"
            detail="Accessible stylesheets did not expose custom properties for this capture."
          />
        )}
      </WorkspacePanel>
    </div>
  );
}

function ColorSwatch({ color }: { readonly color: ColorToken }) {
  const [copied, setCopied] = useState(false);
  const safeColor = safeCssColor(color.normalizedValue);
  const copy = async () => {
    try {
      await copyText(color.normalizedValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="group overflow-hidden rounded-[9px] border border-white/[0.075] bg-white/[0.018] text-left outline-none transition-[border-color,transform] hover:-translate-y-0.5 hover:border-white/[0.14] focus-visible:ring-2 focus-visible:ring-blue-400/50"
      title={`Copy ${color.normalizedValue}`}
    >
      <div className="relative h-20 border-b border-white/[0.075] bg-[linear-gradient(45deg,#15161a_25%,transparent_25%,transparent_75%,#15161a_75%),linear-gradient(45deg,#15161a_25%,#0f1013_25%,#0f1013_75%,#15161a_75%)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]">
        <div className="absolute inset-0" style={{ backgroundColor: safeColor }} />
        <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md bg-black/55 text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100">
          <Copy className="size-3" />
        </span>
      </div>
      <div className="p-2.5">
        <p className="truncate font-mono text-[9px] text-zinc-300">
          {copied ? 'Copied' : color.normalizedValue}
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-[8px] capitalize text-zinc-650">
            {color.inferredRole?.replaceAll('-', ' ') ?? 'Observed color'}
          </span>
          <span className="shrink-0 text-[8px] tabular-nums text-zinc-750">
            {color.occurrences}×
          </span>
        </div>
      </div>
    </button>
  );
}

function SpacingRow({
  token,
  maxPixels,
}: {
  readonly token: MeasurementToken;
  readonly maxPixels: number;
}) {
  const pixels = (token.pixels ?? Number.parseFloat(token.value)) || 0;
  const width = maxPixels > 0 ? Math.max(4, (Math.min(pixels, maxPixels) / maxPixels) * 100) : 4;
  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)_36px] items-center gap-2">
      <span className="truncate font-mono text-[9px] text-zinc-500">{token.value}</span>
      <div className="h-4 rounded-sm bg-white/[0.025] p-1">
        <div
          className="h-full rounded-[2px] bg-gradient-to-r from-blue-500/55 to-violet-400/45"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-right text-[8px] tabular-nums text-zinc-700">{token.occurrences}×</span>
    </div>
  );
}

function maxMeasurement(tokens: MeasurementToken[]): number {
  return Math.max(
    1,
    ...tokens.slice(0, 16).map((token) => (token.pixels ?? Number.parseFloat(token.value)) || 0),
  );
}

function inferBaseIncrement(tokens: MeasurementToken[]): string {
  const values = tokens
    .map((token) => token.pixels)
    .filter((value): value is number => value !== null && value > 0 && value <= 32)
    .sort((a, b) => a - b);
  if (values.length === 0) return 'Not enough data';
  const likely = values.find((value) => value >= 4) ?? values[0];
  return `${likely ?? 0}px`;
}

function safeRadius(value: string): string {
  return /^\d+(?:\.\d+)?(?:px|rem|em|%)?(?:\s+\d+(?:\.\d+)?(?:px|rem|em|%)?){0,3}$/u.test(
    value.trim(),
  )
    ? value
    : '0px';
}

function safeShadow(value: string): string {
  const candidate = value.trim();
  return candidate.length <= 512 && !/url\s*\(/iu.test(candidate) ? candidate : 'none';
}
