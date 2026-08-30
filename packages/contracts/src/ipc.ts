import { z } from 'zod';

import { CrawlConfigSchema } from './config.js';
import { SitepullErrorSchema, type SitepullError } from './errors.js';
import { CaptureEventSchema } from './events.js';
import { CaptureManifestSchema } from './manifests.js';
import {
  ByteCountSchema,
  CaptureIdSchema,
  FileSystemPathSchema,
  HttpUrlSchema,
  SafeRelativePathSchema,
} from './primitives.js';
import { RecentsIndexSchema } from './recents.js';
import { CaptureResultSummarySchema } from './results.js';

export const SITEPULL_IPC_CHANNELS = {
  startCapture: 'sitepull:capture:start',
  cancelCapture: 'sitepull:capture:cancel',
  getCapture: 'sitepull:capture:get',
  exportCapture: 'sitepull:capture:export',
  listRecents: 'sitepull:recents:list',
  selectOutputDirectory: 'sitepull:dialog:select-output-directory',
  readCaptureFile: 'sitepull:capture:file:read',
  openCaptureFolder: 'sitepull:capture:folder:open',
  revealCaptureInFinder: 'sitepull:capture:folder:reveal',
  copyAiContext: 'sitepull:capture:ai-context:copy',
  captureEvent: 'sitepull:capture:event',
} as const;

export const EmptyPayloadSchema = z.object({}).strict();

export const StartCapturePayloadSchema = z
  .object({
    url: HttpUrlSchema,
    allowHttpFallback: z.boolean().optional(),
    outputDirectory: FileSystemPathSchema.optional(),
    config: CrawlConfigSchema.optional(),
  })
  .strict();

export const CaptureReferencePayloadSchema = z
  .object({
    captureId: CaptureIdSchema,
  })
  .strict();

export const CancelCapturePayloadSchema = CaptureReferencePayloadSchema;
export const GetCapturePayloadSchema = CaptureReferencePayloadSchema;
export const OpenCaptureFolderPayloadSchema = CaptureReferencePayloadSchema;
export const RevealCaptureInFinderPayloadSchema = CaptureReferencePayloadSchema;
export const CopyAiContextPayloadSchema = CaptureReferencePayloadSchema;

export const ExportModeSchema = z.enum(['ai-pack', 'full-capture']);

export const ExportCapturePayloadSchema = z
  .object({
    captureId: CaptureIdSchema,
    mode: ExportModeSchema,
  })
  .strict();

export const ReadCaptureFilePayloadSchema = z
  .object({
    captureId: CaptureIdSchema,
    relativePath: SafeRelativePathSchema,
    maxBytes: z
      .number()
      .int()
      .min(1_024)
      .max(10 * 1_024 * 1_024)
      .default(1_048_576),
  })
  .strict();

export const StartCaptureResultSchema = z
  .object({
    captureId: CaptureIdSchema,
  })
  .strict();

export const CancelCaptureResultSchema = z
  .object({
    captureId: CaptureIdSchema,
    cancellationRequested: z.boolean(),
  })
  .strict();

export const ExportCaptureResultSchema = z
  .object({
    captureId: CaptureIdSchema,
    mode: ExportModeSchema,
    archivePath: FileSystemPathSchema,
    byteSize: ByteCountSchema,
  })
  .strict();

export const FilePreviewResultSchema = z
  .object({
    relativePath: SafeRelativePathSchema,
    content: z.string(),
    byteSize: ByteCountSchema,
    truncated: z.boolean(),
    language: z.string().max(128).nullable(),
  })
  .strict();

export const OutputDirectorySelectionResultSchema = z
  .object({
    cancelled: z.boolean(),
    path: FileSystemPathSchema.nullable(),
  })
  .strict()
  .refine((selection) => selection.cancelled === (selection.path === null), {
    message: 'Cancelled selections must have a null path',
    path: ['path'],
  });

export const IpcSuccessSchema = z
  .object({
    ok: z.literal(true),
    data: z.unknown(),
  })
  .strict();

export const IpcFailureSchema = z
  .object({
    ok: z.literal(false),
    error: SitepullErrorSchema,
  })
  .strict();

export const IpcResponseSchema = z.discriminatedUnion('ok', [IpcSuccessSchema, IpcFailureSchema]);

const StartCaptureRequestSchema = z
  .object({
    channel: z.literal(SITEPULL_IPC_CHANNELS.startCapture),
    payload: StartCapturePayloadSchema,
  })
  .strict();

const CancelCaptureRequestSchema = z
  .object({
    channel: z.literal(SITEPULL_IPC_CHANNELS.cancelCapture),
    payload: CancelCapturePayloadSchema,
  })
  .strict();

const GetCaptureRequestSchema = z
  .object({
    channel: z.literal(SITEPULL_IPC_CHANNELS.getCapture),
    payload: GetCapturePayloadSchema,
  })
  .strict();

const ExportCaptureRequestSchema = z
  .object({
    channel: z.literal(SITEPULL_IPC_CHANNELS.exportCapture),
    payload: ExportCapturePayloadSchema,
  })
  .strict();

const ListRecentsRequestSchema = z
  .object({
    channel: z.literal(SITEPULL_IPC_CHANNELS.listRecents),
    payload: EmptyPayloadSchema,
  })
  .strict();

const SelectOutputDirectoryRequestSchema = z
  .object({
    channel: z.literal(SITEPULL_IPC_CHANNELS.selectOutputDirectory),
    payload: EmptyPayloadSchema,
  })
  .strict();

const ReadCaptureFileRequestSchema = z
  .object({
    channel: z.literal(SITEPULL_IPC_CHANNELS.readCaptureFile),
    payload: ReadCaptureFilePayloadSchema,
  })
  .strict();

const OpenCaptureFolderRequestSchema = z
  .object({
    channel: z.literal(SITEPULL_IPC_CHANNELS.openCaptureFolder),
    payload: OpenCaptureFolderPayloadSchema,
  })
  .strict();

const RevealCaptureRequestSchema = z
  .object({
    channel: z.literal(SITEPULL_IPC_CHANNELS.revealCaptureInFinder),
    payload: RevealCaptureInFinderPayloadSchema,
  })
  .strict();

const CopyAiContextRequestSchema = z
  .object({
    channel: z.literal(SITEPULL_IPC_CHANNELS.copyAiContext),
    payload: CopyAiContextPayloadSchema,
  })
  .strict();

export const IpcRequestSchema = z.discriminatedUnion('channel', [
  StartCaptureRequestSchema,
  CancelCaptureRequestSchema,
  GetCaptureRequestSchema,
  ExportCaptureRequestSchema,
  ListRecentsRequestSchema,
  SelectOutputDirectoryRequestSchema,
  ReadCaptureFileRequestSchema,
  OpenCaptureFolderRequestSchema,
  RevealCaptureRequestSchema,
  CopyAiContextRequestSchema,
]);

/** Request validators keyed by the exact channel registered in Electron main. */
export const SITEPULL_IPC_PAYLOAD_SCHEMAS = {
  [SITEPULL_IPC_CHANNELS.startCapture]: StartCapturePayloadSchema,
  [SITEPULL_IPC_CHANNELS.cancelCapture]: CancelCapturePayloadSchema,
  [SITEPULL_IPC_CHANNELS.getCapture]: GetCapturePayloadSchema,
  [SITEPULL_IPC_CHANNELS.exportCapture]: ExportCapturePayloadSchema,
  [SITEPULL_IPC_CHANNELS.listRecents]: EmptyPayloadSchema,
  [SITEPULL_IPC_CHANNELS.selectOutputDirectory]: EmptyPayloadSchema,
  [SITEPULL_IPC_CHANNELS.readCaptureFile]: ReadCaptureFilePayloadSchema,
  [SITEPULL_IPC_CHANNELS.openCaptureFolder]: OpenCaptureFolderPayloadSchema,
  [SITEPULL_IPC_CHANNELS.revealCaptureInFinder]: RevealCaptureInFinderPayloadSchema,
  [SITEPULL_IPC_CHANNELS.copyAiContext]: CopyAiContextPayloadSchema,
} as const;

export const IpcCaptureEventPayloadSchema = CaptureEventSchema;
export const IpcCaptureManifestResultSchema = CaptureManifestSchema;
export const IpcRecentsResultSchema = RecentsIndexSchema;
export const IpcCaptureSummaryResultSchema = CaptureResultSummarySchema;

export const SystemActionResultSchema = z
  .object({
    completed: z.boolean(),
  })
  .strict();

export type SitepullIpcChannel = (typeof SITEPULL_IPC_CHANNELS)[keyof typeof SITEPULL_IPC_CHANNELS];

export type IpcResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: SitepullError };

/** The only capabilities exposed by the Electron preload bridge. */
export interface SitepullDesktopApi {
  readonly startCapture: (payload: StartCapturePayload) => Promise<IpcResult<StartCaptureResult>>;
  readonly cancelCapture: (
    payload: CancelCapturePayload,
  ) => Promise<IpcResult<CancelCaptureResult>>;
  readonly getCapture: (
    payload: GetCapturePayload,
  ) => Promise<IpcResult<z.infer<typeof CaptureManifestSchema>>>;
  readonly exportCapture: (
    payload: ExportCapturePayload,
  ) => Promise<IpcResult<ExportCaptureResult>>;
  readonly listRecents: () => Promise<IpcResult<z.infer<typeof RecentsIndexSchema>>>;
  readonly selectOutputDirectory: () => Promise<IpcResult<OutputDirectorySelectionResult>>;
  readonly readCaptureFile: (
    payload: ReadCaptureFilePayload,
  ) => Promise<IpcResult<FilePreviewResult>>;
  readonly openCaptureFolder: (
    payload: CaptureReferencePayload,
  ) => Promise<IpcResult<SystemActionResult>>;
  readonly revealCaptureInFinder: (
    payload: CaptureReferencePayload,
  ) => Promise<IpcResult<SystemActionResult>>;
  readonly copyAiContext: (
    payload: CaptureReferencePayload,
  ) => Promise<IpcResult<SystemActionResult>>;
  readonly onCaptureEvent: (
    listener: (event: z.infer<typeof CaptureEventSchema>) => void,
  ) => () => void;
}

export type StartCapturePayload = z.infer<typeof StartCapturePayloadSchema>;
export type CaptureReferencePayload = z.infer<typeof CaptureReferencePayloadSchema>;
export type CancelCapturePayload = z.infer<typeof CancelCapturePayloadSchema>;
export type GetCapturePayload = z.infer<typeof GetCapturePayloadSchema>;
export type ExportMode = z.infer<typeof ExportModeSchema>;
export type ExportCapturePayload = z.infer<typeof ExportCapturePayloadSchema>;
export type ReadCaptureFilePayload = z.infer<typeof ReadCaptureFilePayloadSchema>;
export type StartCaptureResult = z.infer<typeof StartCaptureResultSchema>;
export type CancelCaptureResult = z.infer<typeof CancelCaptureResultSchema>;
export type ExportCaptureResult = z.infer<typeof ExportCaptureResultSchema>;
export type FilePreviewResult = z.infer<typeof FilePreviewResultSchema>;
export type OutputDirectorySelectionResult = z.infer<typeof OutputDirectorySelectionResultSchema>;
export type IpcSuccess = z.infer<typeof IpcSuccessSchema>;
export type IpcFailure = z.infer<typeof IpcFailureSchema>;
export type IpcResponse = z.infer<typeof IpcResponseSchema>;
export type IpcRequest = z.infer<typeof IpcRequestSchema>;
export type SystemActionResult = z.infer<typeof SystemActionResultSchema>;
