import { Dialog } from '@base-ui/react/dialog';
import type { SerializedSitepullError } from '@sitepull/contracts';
import { ArrowLeft, CircleAlert, Clipboard, RotateCw, X } from 'lucide-react';
import { useState } from 'react';

import type { SitepullController } from '../hooks/use-sitepull.js';
import { copyText, readableStage } from '../lib/utils.js';
import { buttonVariants } from './ui/button-variants.js';
import { Button } from './ui/button.js';

interface ErrorViewProps {
  readonly controller: SitepullController;
}

const ERROR_GUIDANCE: Partial<Record<SerializedSitepullError['code'], string>> = {
  DNS_FAILED: 'Check the hostname and your network connection, then try again.',
  TLS_FAILED:
    'The site did not establish a trusted TLS connection. Verify it opens in your system browser.',
  NAVIGATION_TIMEOUT:
    'The page did not become ready before the configured timeout. Increase it in Advanced Settings or retry.',
  HTTP_CLIENT_ERROR:
    'The server says this route is unavailable or requires different access. Check the address and open it in your browser before retrying.',
  HTTP_FORBIDDEN:
    'The server declined the browser request. Sitepull will not attempt to bypass access controls.',
  NO_HTML_DOCUMENT:
    'The address did not return a browser-renderable HTML page. Check that this is a website route.',
  OUTPUT_NOT_WRITABLE:
    'Choose a different output folder with write permission and enough free space.',
  BROWSER_NOT_INSTALLED:
    'Reinstall the desktop package, or install the selected Playwright browser in a source/CLI setup.',
  PRIVATE_NETWORK_BLOCKED:
    'Private and local network destinations are blocked by the default safety policy.',
  CAPTURE_CANCELLED: 'The capture stopped cleanly before the project was packaged.',
};

export function ErrorView({ controller }: ErrorViewProps) {
  const { model, canRetry, retry, goHome } = controller;
  const error = model.error;
  const [copied, setCopied] = useState(false);
  if (!error) return null;

  const detailText = JSON.stringify(error, null, 2);
  const copy = async () => {
    try {
      await copyText(detailText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid h-full place-items-center overflow-y-auto bg-[radial-gradient(circle_at_50%_28%,rgba(160,60,70,.08),transparent_38%)] px-6 py-12">
      <section className="w-full max-w-[540px] text-center" aria-labelledby="error-heading">
        <div className="mx-auto mb-5 grid size-11 place-items-center rounded-[12px] border border-red-400/15 bg-red-400/[0.07] shadow-[0_12px_40px_rgba(0,0,0,.25)]">
          <CircleAlert className="size-5 text-red-400" strokeWidth={1.7} />
        </div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-red-400/70">
          {error.code.replaceAll('_', ' ')}
        </p>
        <h1
          id="error-heading"
          className="text-[23px] font-semibold tracking-[-0.035em] text-zinc-100"
        >
          Capture could not finish
        </h1>
        <p className="mx-auto mt-3 max-w-[470px] text-[13px] leading-5 text-zinc-400">
          {error.message}
        </p>
        <p className="mx-auto mt-2 max-w-[470px] text-[12px] leading-5 text-zinc-600">
          {ERROR_GUIDANCE[error.code] ??
            'Review the details below, adjust the capture settings if needed, and retry.'}
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-2">
          {canRetry ? (
            <Button variant="primary" onClick={retry}>
              <RotateCw className="size-3.5" /> Retry
            </Button>
          ) : null}
          <Dialog.Root>
            <Dialog.Trigger className={buttonVariants({ variant: 'secondary', size: 'md' })}>
              Show Details
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="dialog-backdrop fixed inset-0 z-[90] bg-black/65 backdrop-blur-[3px]" />
              <Dialog.Viewport className="fixed inset-0 z-[91] grid place-items-center overflow-y-auto p-5">
                <Dialog.Popup className="dialog-popup w-full max-w-[620px] rounded-[14px] border border-white/[0.1] bg-[#15161b] p-5 text-left shadow-[0_32px_100px_rgba(0,0,0,.6)] outline-none">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Dialog.Title className="text-[15px] font-semibold text-zinc-100">
                        Capture error details
                      </Dialog.Title>
                      <Dialog.Description className="mt-1 text-[11px] leading-4 text-zinc-500">
                        Use this structured report when diagnosing the capture. Sensitive page
                        content is not included.
                      </Dialog.Description>
                    </div>
                    <Dialog.Close
                      className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-500 outline-none hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-blue-400/50"
                      aria-label="Close details"
                    >
                      <X className="size-4" />
                    </Dialog.Close>
                  </div>

                  <dl className="mt-5 grid grid-cols-[100px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[11px]">
                    <dt className="text-zinc-600">Code</dt>
                    <dd className="font-mono text-zinc-300">{error.code}</dd>
                    <dt className="text-zinc-600">Stage</dt>
                    <dd className="text-zinc-300">
                      {error.stage ? readableStage(error.stage) : 'Desktop orchestration'}
                    </dd>
                    <dt className="text-zinc-600">Retryable</dt>
                    <dd className="text-zinc-300">{error.retryable ? 'Yes' : 'No'}</dd>
                  </dl>

                  <pre className="mt-4 max-h-[260px] overflow-auto rounded-[9px] border border-white/[0.07] bg-[#090a0d] p-3 font-mono text-[10px] leading-5 text-zinc-400">
                    {detailText}
                  </pre>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => void copy()}>
                      <Clipboard className="size-3.5" /> {copied ? 'Copied' : 'Copy Error'}
                    </Button>
                    <Dialog.Close className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                      Done
                    </Dialog.Close>
                  </div>
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>
          <Button variant="ghost" onClick={goHome}>
            <ArrowLeft className="size-3.5" /> New capture
          </Button>
        </div>
      </section>
    </div>
  );
}
