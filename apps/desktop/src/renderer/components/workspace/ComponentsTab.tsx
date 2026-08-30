import { Dialog } from '@base-ui/react/dialog';
import type { CaptureManifest, ComponentCandidate } from '@sitepull/contracts';
import { Braces, ChevronRight, Component, Layers3, Route, X } from 'lucide-react';
import { useState } from 'react';

import { captureFileUrl, formatCount, isCaptureScreenshotPath } from '../../lib/utils.js';
import {
  ArtifactImage,
  ConfidenceBar,
  EmptyPanel,
  SectionHeading,
  WorkspacePanel,
} from './shared.js';

export function ComponentsTab({ manifest }: { readonly manifest: CaptureManifest }) {
  const [selected, setSelected] = useState<ComponentCandidate | null>(null);
  const components = manifest.design.components;

  if (components.length === 0) {
    return (
      <WorkspacePanel>
        <EmptyPanel
          icon={Component}
          title="No repeated component candidates"
          detail="The deterministic analyzer did not find a repeated structure strong enough to classify as reusable."
        />
      </WorkspacePanel>
    );
  }

  return (
    <>
      <div className="pb-8">
        <div className="mb-4">
          <SectionHeading
            eyebrow="Deterministic inference"
            title={`${components.length} component candidates`}
            aside={
              <span className="text-[10px] text-zinc-650">
                Names are suggested, not source component names
              </span>
            }
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {components.map((component) => (
            <button
              key={component.signature}
              type="button"
              onClick={() => setSelected(component)}
              className="group rounded-[11px] border border-white/[0.07] bg-white/[0.018] p-3.5 text-left outline-none transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-white/[0.13] hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-blue-400/50"
            >
              <div className="flex items-start gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-blue-400/15 bg-blue-400/[0.06] text-blue-300/75">
                  <Component className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[12px] font-medium text-zinc-250">
                      {component.suggestedName}
                    </h3>
                    <span className="rounded border border-white/[0.07] px-1 py-0.5 text-[7px] font-semibold uppercase tracking-[0.08em] text-zinc-650">
                      Inferred
                    </span>
                  </div>
                  <p className="mt-1 text-[9px] text-zinc-650">
                    {formatCount(component.occurrences)} occurrences across{' '}
                    {component.routes.length} {component.routes.length === 1 ? 'route' : 'routes'}
                  </p>
                </div>
                <ChevronRight className="mt-1 size-3.5 text-zinc-700 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-400" />
              </div>

              <div className="mt-4">
                <ConfidenceBar confidence={component.confidence} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {component.routes.slice(0, 4).map((route) => (
                  <span
                    key={route}
                    className="max-w-[120px] truncate rounded bg-white/[0.035] px-1.5 py-1 font-mono text-[8px] text-zinc-600"
                  >
                    {route}
                  </span>
                ))}
                {component.routes.length > 4 ? (
                  <span className="rounded bg-white/[0.025] px-1.5 py-1 text-[8px] text-zinc-700">
                    +{component.routes.length - 4}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 truncate font-mono text-[8px] text-zinc-750">
                {component.signature}
              </p>
            </button>
          ))}
        </div>
      </div>

      <Dialog.Root
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop fixed inset-0 z-[90] bg-black/65 backdrop-blur-[3px]" />
          <Dialog.Viewport className="fixed inset-0 z-[91] grid place-items-center overflow-y-auto p-5">
            <Dialog.Popup className="dialog-popup flex max-h-[min(760px,calc(100vh-40px))] w-full max-w-[820px] flex-col overflow-hidden rounded-[14px] border border-white/[0.1] bg-[#14151a] shadow-[0_32px_100px_rgba(0,0,0,.62)] outline-none">
              {selected ? (
                <ComponentDetail
                  captureId={manifest.captureId}
                  component={selected}
                  onClose={() => setSelected(null)}
                />
              ) : null}
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function ComponentDetail({
  captureId,
  component,
  onClose,
}: {
  readonly captureId: string;
  readonly component: ComponentCandidate;
  readonly onClose: () => void;
}) {
  const example = component.examples.find(
    (item) => item.screenshotPath && isCaptureScreenshotPath(item.screenshotPath),
  );
  const styles = Object.entries(component.styleSummary);
  return (
    <>
      <div className="flex items-start gap-3 border-b border-white/[0.065] px-5 py-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-[9px] border border-blue-400/15 bg-blue-400/[0.06] text-blue-300/80">
          <Component className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <Dialog.Title className="flex items-center gap-2 text-[15px] font-semibold text-zinc-100">
            {component.suggestedName}
            <span className="rounded border border-white/[0.07] px-1.5 py-0.5 text-[7px] uppercase tracking-[0.1em] text-zinc-650">
              Inferred name
            </span>
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[10px] text-zinc-600">
            Repeated rendered structure identified from DOM hierarchy, classes, dimensions, and
            computed styles.
          </Dialog.Description>
        </div>
        <Dialog.Close
          onClick={onClose}
          className="grid size-8 place-items-center rounded-md text-zinc-500 outline-none hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-blue-400/50"
          aria-label="Close component details"
        >
          <X className="size-4" />
        </Dialog.Close>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid grid-cols-3 gap-2">
          <DetailMetric label="Confidence" value={`${Math.round(component.confidence * 100)}%`} />
          <DetailMetric label="Occurrences" value={formatCount(component.occurrences)} />
          <DetailMetric label="Routes" value={formatCount(component.routes.length)} />
        </div>

        {example?.screenshotPath ? (
          <div className="mt-5">
            <SectionHeading eyebrow="Captured example" title={example.route} />
            <ArtifactImage
              src={captureFileUrl(captureId, example.screenshotPath)}
              alt={`Captured example of ${component.suggestedName}`}
              frameClassName="mt-3 h-[260px] rounded-[9px] border border-white/[0.08]"
            />
          </div>
        ) : null}

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-650">
              <Route className="size-3.5" /> Observed routes
            </div>
            <div className="rounded-[9px] border border-white/[0.07] bg-black/15 p-2">
              {component.routes.map((route) => (
                <div
                  key={route}
                  className="border-b border-white/[0.045] px-2 py-1.5 font-mono text-[9px] text-zinc-450 last:border-0"
                >
                  {route}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-650">
              <Layers3 className="size-3.5" /> Computed visual properties
            </div>
            <div className="max-h-[210px] overflow-auto rounded-[9px] border border-white/[0.07] bg-black/15 p-2">
              {styles.length > 0 ? (
                styles.map(([property, value]) => (
                  <div
                    key={property}
                    className="grid grid-cols-[105px_minmax(0,1fr)] gap-2 border-b border-white/[0.045] px-2 py-1.5 font-mono text-[8px] last:border-0"
                  >
                    <span className="truncate text-blue-300/65">{property}</span>
                    <span className="truncate text-zinc-500" title={value}>
                      {value}
                    </span>
                  </div>
                ))
              ) : (
                <p className="p-2 text-[9px] text-zinc-700">
                  No recurring computed properties were retained.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-650">
            <Braces className="size-3.5" /> DOM signature
          </div>
          <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-all rounded-[9px] border border-white/[0.07] bg-[#090a0d] p-3 font-mono text-[9px] leading-4 text-zinc-500">
            {component.signature}
          </pre>
        </div>

        {component.examples.length > 0 ? (
          <div className="mt-5">
            <SectionHeading
              eyebrow="Evidence"
              title="Example DOM locations"
              aside={<span className="text-[9px] text-zinc-700">{component.examples.length}</span>}
            />
            <div className="mt-2 max-h-[180px] overflow-auto rounded-[9px] border border-white/[0.07]">
              {component.examples.map((item, index) => (
                <div
                  key={`${item.route}-${item.domPath}-${index}`}
                  className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 border-b border-white/[0.05] px-3 py-2 font-mono text-[8px] last:border-0"
                >
                  <span className="truncate text-zinc-500">{item.route}</span>
                  <span className="truncate text-zinc-700" title={item.domPath}>
                    {item.domPath}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function DetailMetric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-[9px] border border-white/[0.07] bg-white/[0.02] px-3 py-3">
      <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-zinc-700">{label}</p>
      <p className="mt-1 text-[16px] font-medium tracking-[-0.03em] text-zinc-250 tabular-nums">
        {value}
      </p>
    </div>
  );
}
