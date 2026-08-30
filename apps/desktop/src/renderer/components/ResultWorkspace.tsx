import { Tabs } from '@base-ui/react/tabs';
import { Archive, Clipboard, FolderOpen, LoaderCircle, Package, PanelTopOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import type { SitepullController } from '../hooks/use-sitepull.js';
import { formatBytes, relativeTime } from '../lib/utils.js';
import type { ToastState } from './Toast.js';
import { Button } from './ui/button.js';
import { AssetsTab } from './workspace/AssetsTab.js';
import { ComponentsTab } from './workspace/ComponentsTab.js';
import { DesignTab } from './workspace/DesignTab.js';
import { FilesTab } from './workspace/FilesTab.js';
import { LogsTab } from './workspace/LogsTab.js';
import { OverviewTab } from './workspace/OverviewTab.js';
import { PagesTab } from './workspace/PagesTab.js';

interface ResultWorkspaceProps {
  readonly controller: SitepullController;
  readonly notify: (toast: ToastState) => void;
}

const WORKSPACE_TABS = [
  'Overview',
  'Pages',
  'Design',
  'Components',
  'Assets',
  'Files',
  'Logs',
] as const;

export function ResultWorkspace({ controller, notify }: ResultWorkspaceProps) {
  const { model, exportCapture, invokeSystemAction, readCaptureFile } = controller;
  const manifest = model.manifest;
  const [workingAction, setWorkingAction] = useState<string | null>(null);
  if (!manifest) return null;

  const exportProject = async (mode: 'ai-pack' | 'full-capture') => {
    setWorkingAction(mode);
    try {
      const response = await exportCapture(mode);
      if (!response) return;
      if (!response.ok) {
        if (response.error.code === 'CAPTURE_CANCELLED') return;
        notify({ tone: 'error', message: response.error.message });
      } else
        notify({
          tone: 'success',
          message: `${mode === 'ai-pack' ? 'AI Pack' : 'Full Capture'} exported · ${formatBytes(response.data.byteSize)}`,
        });
    } catch (error) {
      notify({
        tone: 'error',
        message: error instanceof Error ? error.message : 'The archive could not be exported.',
      });
    } finally {
      setWorkingAction(null);
    }
  };

  const runAction = async (action: 'open' | 'reveal' | 'copy') => {
    setWorkingAction(action);
    try {
      const response = await invokeSystemAction(action);
      if (!response) return;
      if (!response.ok) notify({ tone: 'error', message: response.error.message });
      else
        notify({
          tone: 'success',
          message:
            action === 'copy'
              ? 'AI_CONTEXT.md copied to the clipboard.'
              : action === 'reveal'
                ? 'Capture revealed in the system file browser.'
                : 'Capture folder opened.',
        });
    } catch (error) {
      notify({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'The desktop action could not be completed.',
      });
    } finally {
      setWorkingAction(null);
    }
  };

  return (
    <Tabs.Root defaultValue="Overview" className="flex h-full min-h-0 flex-col bg-[#0a0b0e]">
      <div className="shrink-0 border-b border-white/[0.065] bg-[#0d0e12] px-4 pt-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[21px] font-semibold tracking-[-0.035em] text-zinc-100">
                  {manifest.source.hostname}
                </h1>
                <span className="rounded border border-emerald-400/15 bg-emerald-400/[0.055] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-emerald-300/65">
                  Captured
                </span>
              </div>
              <p className="mt-1 text-[10px] text-zinc-600">
                {manifest.completedAt
                  ? `Captured ${relativeTime(manifest.completedAt)}`
                  : 'Capture complete'}
                <span className="mx-1.5 text-zinc-750">·</span>
                {manifest.summary.counts.pages} Pages
                <span className="mx-1.5 text-zinc-750">·</span>
                {manifest.summary.counts.assets} Assets
                <span className="mx-1.5 text-zinc-750">·</span>
                {manifest.summary.counts.components} Components
                <span className="mx-1.5 text-zinc-750">·</span>
                {formatBytes(manifest.summary.counts.bytes)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="primary"
                size="sm"
                disabled={workingAction !== null}
                onClick={() => void exportProject('ai-pack')}
              >
                {workingAction === 'ai-pack' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Package className="size-3.5" />
                )}
                {workingAction === 'ai-pack' ? 'Exporting AI Pack…' : 'Export AI Pack'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={workingAction !== null}
                onClick={() => void exportProject('full-capture')}
              >
                {workingAction === 'full-capture' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Archive className="size-3.5" />
                )}
                {workingAction === 'full-capture' ? 'Exporting…' : 'Full Capture'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={workingAction !== null}
                onClick={() => void runAction('open')}
              >
                {workingAction === 'open' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <FolderOpen className="size-3.5" />
                )}
                {workingAction === 'open' ? 'Opening…' : 'Open Folder'}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={workingAction !== null}
                onClick={() => void runAction('reveal')}
                title="Reveal capture in file browser"
                aria-label="Reveal capture in file browser"
              >
                {workingAction === 'reveal' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <PanelTopOpen className="size-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={workingAction !== null}
                onClick={() => void runAction('copy')}
                title="Copy AI context"
                aria-label="Copy AI context"
              >
                {workingAction === 'copy' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Clipboard className="size-3.5" />
                )}
              </Button>
            </div>
          </div>

          <Tabs.List
            className="relative flex min-w-0 gap-1 overflow-x-auto"
            aria-label="Capture workspace sections"
          >
            {WORKSPACE_TABS.map((tab) => (
              <Tabs.Tab
                key={tab}
                value={tab}
                className="workspace-tab relative shrink-0 rounded-t-[7px] px-3 py-2 text-[10px] font-medium text-zinc-600 outline-none transition-colors hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400/50 data-[selected]:text-zinc-100"
              >
                {tab}
              </Tabs.Tab>
            ))}
            <Tabs.Indicator className="workspace-tab-indicator absolute bottom-0 h-px bg-blue-400 transition-[left,width] duration-200" />
          </Tabs.List>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-[1440px]">
          <TabPanel value="Overview">
            <OverviewTab manifest={manifest} />
          </TabPanel>
          <TabPanel value="Pages">
            <PagesTab manifest={manifest} />
          </TabPanel>
          <TabPanel value="Design">
            <DesignTab manifest={manifest} />
          </TabPanel>
          <TabPanel value="Components">
            <ComponentsTab manifest={manifest} />
          </TabPanel>
          <TabPanel value="Assets">
            <AssetsTab manifest={manifest} />
          </TabPanel>
          <TabPanel value="Files">
            <FilesTab manifest={manifest} readCaptureFile={readCaptureFile} />
          </TabPanel>
          <TabPanel value="Logs">
            <LogsTab liveLogs={model.session?.logs ?? []} readCaptureFile={readCaptureFile} />
          </TabPanel>
        </div>
      </div>
    </Tabs.Root>
  );
}

function TabPanel({ value, children }: { readonly value: string; readonly children: ReactNode }) {
  return (
    <Tabs.Panel
      value={value}
      keepMounted
      className="outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
    >
      {children}
    </Tabs.Panel>
  );
}
