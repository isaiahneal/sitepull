import type {
  CaptureEvent,
  CaptureManifest,
  CaptureRecipe,
  CrawlConfig,
  LogEvent,
  ProgressEvent,
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
  lastRequest: {
    url: string;
    allowHttpFallback?: boolean;
    outputDirectory?: string;
    config: CrawlConfig;
  } | null;
}

export interface StartCaptureOptions {
  url: string;
  allowHttpFallback?: boolean;
  outputDirectory?: string;
  config: CrawlConfig;
}
