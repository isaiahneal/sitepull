import type {
  CaptureEvent,
  CaptureManifest,
  CaptureRecipe,
  CrawlConfig,
  LogEvent,
  ProgressEvent,
  ProxyPoolRecipe,
  ProxyPoolRequest,
  RecentCapture,
  SerializedSitepullError,
} from '@sitepull/contracts';

export type AppScreen = 'empty' | 'capturing' | 'error' | 'results';

export interface CaptureSession {
  captureId: string;
  progress: ProgressEvent | null;
  logs: LogEvent[];
  events: CaptureEvent[];
  startedAt: number;
}

export interface AppModel {
  screen: AppScreen;
  recents: RecentCapture[];
  recentsLoading: boolean;
  recentsError: string | null;
  lastUsedRecipe: CaptureRecipe | null;
  draftRecipe: CaptureRecipe | null;
  viewRecipe: CaptureRecipe | null;
  session: CaptureSession | null;
  manifest: CaptureManifest | null;
  error: SerializedSitepullError | null;
  lastRequest: SafeCaptureRequest | null;
}

export interface StartCaptureOptions {
  url: string;
  allowHttpFallback?: boolean;
  outputDirectory?: string;
  config: CrawlConfig;
  proxyPool?: ProxyPoolRequest;
}

/** Renderer-visible request evidence. Proxy credentials are deliberately absent. */
export interface SafeCaptureRequest {
  url: string;
  allowHttpFallback?: boolean;
  outputDirectory?: string;
  config: CrawlConfig;
  proxyPool: ProxyPoolRecipe | null;
}
