import path from 'node:path';

import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  CancelCaptureResultSchema,
  CancelCapturePayloadSchema,
  CaptureManifestSchema,
  CopyAiContextPayloadSchema,
  EmptyPayloadSchema,
  ExportCapturePayloadSchema,
  ExportCaptureResultSchema,
  FilePreviewResultSchema,
  GetCapturePayloadSchema,
  IpcSuccessSchema,
  OpenCaptureFolderPayloadSchema,
  OutputDirectorySelectionResultSchema,
  ReadCaptureFilePayloadSchema,
  RecentsIndexSchema,
  RevealCaptureInFinderPayloadSchema,
  SITEPULL_IPC_CHANNELS,
  StartCapturePayloadSchema,
  StartCaptureResultSchema,
  SystemActionResultSchema,
  type SitepullIpcChannel,
} from '@sitepull/contracts';

import type { CaptureRegistry } from './capture-registry.js';
import { loadCore } from './core.js';
import { DesktopError, toIpcFailure } from './errors.js';
import {
  copyAiContext,
  openCaptureFolder,
  readCaptureFile,
  revealCaptureInFinder,
} from './file-access.js';
import type { CaptureJobManager } from './job-manager.js';
import type { OutputAuthorization } from './output-authorization.js';
import type { RecentsStore } from './recents-store.js';
import { assertTrustedIpcSender } from './security.js';

interface RuntimeSchema<T> {
  parse(input: unknown): T;
}

interface DesktopIpcServices {
  readonly getMainWindow: () => BrowserWindow | null;
  readonly jobs: CaptureJobManager;
  readonly outputs: OutputAuthorization;
  readonly recents: RecentsStore;
  readonly registry: CaptureRegistry;
}

type RequestChannel = Exclude<SitepullIpcChannel, typeof SITEPULL_IPC_CHANNELS.captureEvent>;

function requireWindow(getMainWindow: () => BrowserWindow | null): BrowserWindow {
  const window = getMainWindow();
  if (window === null || window.isDestroyed()) {
    throw new DesktopError({
      code: 'INTERNAL_ERROR',
      message: 'The Sitepull window is no longer available.',
      stage: 'validation',
    });
  }
  return window;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1_024;
  let unit = units[0] ?? 'KB';
  for (const nextUnit of units.slice(1)) {
    if (value < 1_024) break;
    value /= 1_024;
    unit = nextUnit;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function registerHandler<Payload, Result>(
  channel: RequestChannel,
  payloadSchema: RuntimeSchema<Payload>,
  resultSchema: RuntimeSchema<Result>,
  getMainWindow: () => BrowserWindow | null,
  operation: (event: IpcMainInvokeEvent, payload: Payload) => Promise<Result>,
): void {
  ipcMain.handle(channel, async (event, rawPayload: unknown) => {
    assertTrustedIpcSender(event, getMainWindow);
    try {
      const payload = payloadSchema.parse(rawPayload);
      const data = resultSchema.parse(await operation(event, payload));
      return IpcSuccessSchema.parse({ ok: true, data });
    } catch (error) {
      return toIpcFailure(error, 'The desktop request could not be completed.');
    }
  });
}

export function registerDesktopIpc(services: DesktopIpcServices): () => void {
  const registeredChannels: RequestChannel[] = [];
  const register = <Payload, Result>(
    channel: RequestChannel,
    payloadSchema: RuntimeSchema<Payload>,
    resultSchema: RuntimeSchema<Result>,
    operation: (event: IpcMainInvokeEvent, payload: Payload) => Promise<Result>,
  ): void => {
    registerHandler(channel, payloadSchema, resultSchema, services.getMainWindow, operation);
    registeredChannels.push(channel);
  };

  register(
    SITEPULL_IPC_CHANNELS.startCapture,
    StartCapturePayloadSchema,
    StartCaptureResultSchema,
    async (event, payload) => {
      const outputDirectory = await services.outputs.resolve(payload.outputDirectory);
      return services.jobs.start(payload, outputDirectory, event.sender);
    },
  );

  register(
    SITEPULL_IPC_CHANNELS.cancelCapture,
    CancelCapturePayloadSchema,
    CancelCaptureResultSchema,
    (event, payload) =>
      Promise.resolve({
        captureId: payload.captureId,
        cancellationRequested: services.jobs.cancel(payload.captureId, event.sender.id),
      }),
  );

  register(
    SITEPULL_IPC_CHANNELS.getCapture,
    GetCapturePayloadSchema,
    CaptureManifestSchema,
    async (_event, payload) => services.registry.readManifest(payload.captureId),
  );

  register(SITEPULL_IPC_CHANNELS.listRecents, EmptyPayloadSchema, RecentsIndexSchema, async () => {
    const index = await services.recents.list();
    await Promise.all(
      index.captures
        .filter((capture) => capture.availability === 'available')
        .map((capture) =>
          services.registry.registerExisting(capture.captureId, capture.outputPath),
        ),
    );
    return index;
  });

  register(
    SITEPULL_IPC_CHANNELS.selectOutputDirectory,
    EmptyPayloadSchema,
    OutputDirectorySelectionResultSchema,
    async () => services.outputs.select(requireWindow(services.getMainWindow)),
  );

  register(
    SITEPULL_IPC_CHANNELS.exportCapture,
    ExportCapturePayloadSchema,
    ExportCaptureResultSchema,
    async (_event, payload) => {
      const captureRoot = await services.registry.rootFor(payload.captureId);
      const { exportCaptureArchive, selectExportFiles } = await loadCore();
      const estimate = await selectExportFiles(captureRoot, payload.mode);
      const suffix = payload.mode === 'ai-pack' ? 'ai-pack' : 'full-capture';
      const selection = await dialog.showSaveDialog(requireWindow(services.getMainWindow), {
        title: payload.mode === 'ai-pack' ? 'Export AI Pack' : 'Export Full Capture',
        buttonLabel: 'Export ZIP',
        defaultPath: path.join(
          path.dirname(captureRoot),
          `${path.basename(captureRoot)}-${suffix}.zip`,
        ),
        message: `Estimated compressed size: ${formatBytes(estimate.estimatedCompressedBytes)}`,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (selection.canceled || selection.filePath === undefined) {
        throw new DesktopError({
          code: 'CAPTURE_CANCELLED',
          message: 'Export was cancelled.',
          stage: 'packaging',
        });
      }
      const archivePath = selection.filePath.toLowerCase().endsWith('.zip')
        ? selection.filePath
        : `${selection.filePath}.zip`;
      const result = await exportCaptureArchive({
        captureRoot,
        mode: payload.mode,
        destination: archivePath,
      });
      return {
        captureId: payload.captureId,
        mode: payload.mode,
        archivePath: result.archivePath,
        byteSize: result.compressedBytes,
      };
    },
  );

  register(
    SITEPULL_IPC_CHANNELS.readCaptureFile,
    ReadCaptureFilePayloadSchema,
    FilePreviewResultSchema,
    async (_event, payload) => readCaptureFile(services.registry, payload),
  );

  register(
    SITEPULL_IPC_CHANNELS.openCaptureFolder,
    OpenCaptureFolderPayloadSchema,
    SystemActionResultSchema,
    async (_event, payload) => openCaptureFolder(services.registry, payload.captureId),
  );

  register(
    SITEPULL_IPC_CHANNELS.revealCaptureInFinder,
    RevealCaptureInFinderPayloadSchema,
    SystemActionResultSchema,
    async (_event, payload) => revealCaptureInFinder(services.registry, payload.captureId),
  );

  register(
    SITEPULL_IPC_CHANNELS.copyAiContext,
    CopyAiContextPayloadSchema,
    SystemActionResultSchema,
    async (_event, payload) => copyAiContext(services.registry, payload.captureId),
  );

  return () => {
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
  };
}
