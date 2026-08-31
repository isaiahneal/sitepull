import { contextBridge, ipcRenderer } from 'electron';
import {
  CancelCapturePayloadSchema,
  CancelCaptureResultSchema,
  CaptureJobSnapshotResultSchema,
  CaptureManifestSchema,
  CaptureReferencePayloadSchema,
  EmptyPayloadSchema,
  ExportCapturePayloadSchema,
  ExportCaptureResultSchema,
  FilePreviewResultSchema,
  GetCapturePayloadSchema,
  IpcCaptureEventPayloadSchema,
  IpcResponseSchema,
  OutputDirectorySelectionResultSchema,
  ReadCaptureFilePayloadSchema,
  RecentsIndexSchema,
  SITEPULL_IPC_CHANNELS,
  StartCapturePayloadSchema,
  StartCaptureResultSchema,
  SystemActionResultSchema,
  type IpcResult,
  type SitepullDesktopApi,
} from '@sitepull/contracts';

interface RuntimeSchema<T> {
  parse(input: unknown): T;
}

async function invoke<Payload, Result>(
  channel: string,
  payloadSchema: RuntimeSchema<Payload>,
  resultSchema: RuntimeSchema<Result>,
  payload: Payload,
): Promise<IpcResult<Result>> {
  const response = IpcResponseSchema.parse(
    await ipcRenderer.invoke(channel, payloadSchema.parse(payload)),
  );
  if (!response.ok) return response;
  return { ok: true, data: resultSchema.parse(response.data) };
}

const api = Object.freeze({
  startCapture: (payload) =>
    invoke(
      SITEPULL_IPC_CHANNELS.startCapture,
      StartCapturePayloadSchema,
      StartCaptureResultSchema,
      payload,
    ),
  cancelCapture: (payload) =>
    invoke(
      SITEPULL_IPC_CHANNELS.cancelCapture,
      CancelCapturePayloadSchema,
      CancelCaptureResultSchema,
      payload,
    ),
  getCaptureJob: () =>
    invoke(
      SITEPULL_IPC_CHANNELS.getCaptureJob,
      EmptyPayloadSchema,
      CaptureJobSnapshotResultSchema,
      {},
    ),
  getCapture: (payload) =>
    invoke(
      SITEPULL_IPC_CHANNELS.getCapture,
      GetCapturePayloadSchema,
      CaptureManifestSchema,
      payload,
    ),
  exportCapture: (payload) =>
    invoke(
      SITEPULL_IPC_CHANNELS.exportCapture,
      ExportCapturePayloadSchema,
      ExportCaptureResultSchema,
      payload,
    ),
  listRecents: () =>
    invoke(SITEPULL_IPC_CHANNELS.listRecents, EmptyPayloadSchema, RecentsIndexSchema, {}),
  selectOutputDirectory: () =>
    invoke(
      SITEPULL_IPC_CHANNELS.selectOutputDirectory,
      EmptyPayloadSchema,
      OutputDirectorySelectionResultSchema,
      {},
    ),
  readCaptureFile: (payload) =>
    invoke(
      SITEPULL_IPC_CHANNELS.readCaptureFile,
      ReadCaptureFilePayloadSchema,
      FilePreviewResultSchema,
      payload,
    ),
  openCaptureFolder: (payload) =>
    invoke(
      SITEPULL_IPC_CHANNELS.openCaptureFolder,
      CaptureReferencePayloadSchema,
      SystemActionResultSchema,
      payload,
    ),
  revealCaptureInFinder: (payload) =>
    invoke(
      SITEPULL_IPC_CHANNELS.revealCaptureInFinder,
      CaptureReferencePayloadSchema,
      SystemActionResultSchema,
      payload,
    ),
  copyAiContext: (payload) =>
    invoke(
      SITEPULL_IPC_CHANNELS.copyAiContext,
      CaptureReferencePayloadSchema,
      SystemActionResultSchema,
      payload,
    ),
  onCaptureEvent: (listener) => {
    let subscribed = true;
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (!subscribed) return;
      const parsed = IpcCaptureEventPayloadSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(SITEPULL_IPC_CHANNELS.captureEvent, wrapped);
    return () => {
      if (!subscribed) return;
      subscribed = false;
      ipcRenderer.removeListener(SITEPULL_IPC_CHANNELS.captureEvent, wrapped);
    };
  },
} satisfies SitepullDesktopApi);

contextBridge.exposeInMainWorld('sitepull', api);
