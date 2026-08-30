import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CaptureEvent,
  CaptureManifest,
  ExportMode,
  IpcResult,
  SerializedSitepullError,
  SystemActionResult,
} from '@sitepull/contracts';

import type { AppModel, StartCaptureOptions } from '../types.js';

const INITIAL_MODEL: AppModel = {
  screen: 'empty',
  recents: [],
  recentsLoading: true,
  recentsError: null,
  session: null,
  manifest: null,
  error: null,
  lastRequest: null,
};

function internalError(message: string, details?: Record<string, string>): SerializedSitepullError {
  return {
    name: 'SitepullError',
    code: 'INTERNAL_ERROR',
    message,
    retryable: false,
    ...(details ? { details } : {}),
  };
}

function exceptionMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected desktop bridge error occurred.';
}

export function useSitepull() {
  const [model, setModel] = useState<AppModel>(INITIAL_MODEL);
  const activeCaptureRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const terminalCaptureRef = useRef<string | null>(null);
  const viewGenerationRef = useRef(0);
  const recentsRequestRef = useRef(0);

  const fail = useCallback((error: SerializedSitepullError) => {
    activeCaptureRef.current = null;
    startingRef.current = false;
    setModel((current) => ({ ...current, screen: 'error', error }));
  }, []);

  const loadManifest = useCallback(
    async (captureId: string) => {
      const generation = ++viewGenerationRef.current;
      try {
        const response = await window.sitepull.getCapture({ captureId });
        if (generation !== viewGenerationRef.current) return;
        if (!response.ok) {
          fail(response.error);
          return;
        }
        if (response.data.status === 'failed' && response.data.summary.error) {
          setModel((current) => ({
            ...current,
            screen: 'error',
            manifest: response.data,
            error: response.data.summary.error,
          }));
          return;
        }
        activeCaptureRef.current = null;
        setModel((current) => ({
          ...current,
          screen: 'results',
          manifest: response.data,
          error: null,
        }));
      } catch (error) {
        if (generation !== viewGenerationRef.current) return;
        fail(
          internalError('The completed capture could not be loaded.', {
            cause: exceptionMessage(error),
          }),
        );
      }
    },
    [fail],
  );

  const loadRecents = useCallback(async () => {
    const request = ++recentsRequestRef.current;
    try {
      const response = await window.sitepull.listRecents();
      if (request !== recentsRequestRef.current) return;
      if (!response.ok) {
        setModel((current) => ({
          ...current,
          recentsLoading: false,
          recentsError: response.error.message,
        }));
        return;
      }
      setModel((current) => ({
        ...current,
        recents: response.data.captures,
        recentsLoading: false,
        recentsError: null,
      }));
    } catch (error) {
      if (request !== recentsRequestRef.current) return;
      setModel((current) => ({
        ...current,
        recentsLoading: false,
        recentsError: `Capture history is unavailable: ${exceptionMessage(error)}`,
      }));
    }
  }, []);

  useEffect(() => {
    void loadRecents();
  }, [loadRecents]);

  useEffect(() => {
    const unsubscribe = window.sitepull.onCaptureEvent((event) => {
      if (startingRef.current && activeCaptureRef.current === null) {
        activeCaptureRef.current = event.captureId;
      }
      if (event.captureId !== activeCaptureRef.current) return;

      setModel((current) => {
        const session =
          current.session?.captureId === event.captureId
            ? current.session
            : {
                captureId: event.captureId,
                progress: null,
                logs: [],
                events: [],
                startedAt: eventStartTime(event),
              };
        return {
          ...current,
          session: {
            ...session,
            progress: event.type === 'progress' ? event : session.progress,
            logs: event.type === 'log' ? [...session.logs.slice(-499), event] : session.logs,
            events: [...session.events.slice(-999), event],
          },
        };
      });

      if (event.type === 'complete') {
        terminalCaptureRef.current = event.captureId;
        void loadManifest(event.captureId).then(loadRecents);
      } else if (event.type === 'error') {
        terminalCaptureRef.current = event.captureId;
        fail(event.error);
        void loadRecents();
      }
    });
    return unsubscribe;
  }, [fail, loadManifest, loadRecents]);

  const startCapture = useCallback(
    async (options: StartCaptureOptions) => {
      const generation = ++viewGenerationRef.current;
      startingRef.current = true;
      activeCaptureRef.current = null;
      terminalCaptureRef.current = null;
      setModel((current) => ({
        ...current,
        screen: 'capturing',
        manifest: null,
        error: null,
        lastRequest: options,
        session: null,
      }));

      try {
        const response = await window.sitepull.startCapture({
          url: options.url,
          ...(options.allowHttpFallback === undefined
            ? {}
            : { allowHttpFallback: options.allowHttpFallback }),
          config: options.config,
          ...(options.outputDirectory ? { outputDirectory: options.outputDirectory } : {}),
        });
        if (!response.ok) {
          if (generation !== viewGenerationRef.current) return;
          fail(response.error);
          return;
        }

        if (terminalCaptureRef.current === response.data.captureId) {
          startingRef.current = false;
          return;
        }
        if (generation !== viewGenerationRef.current) return;
        startingRef.current = false;
        if (
          activeCaptureRef.current !== null &&
          activeCaptureRef.current !== response.data.captureId
        ) {
          fail(
            internalError('The desktop bridge returned a mismatched capture identifier.', {
              eventCaptureId: activeCaptureRef.current,
              responseCaptureId: response.data.captureId,
            }),
          );
          return;
        }
        activeCaptureRef.current = response.data.captureId;
        setModel((current) => ({
          ...current,
          session:
            current.session?.captureId === response.data.captureId
              ? current.session
              : {
                  captureId: response.data.captureId,
                  progress: null,
                  logs: [],
                  events: [],
                  startedAt: Date.now(),
                },
        }));
      } catch (error) {
        if (generation !== viewGenerationRef.current) return;
        startingRef.current = false;
        fail(
          internalError('Sitepull could not start the capture.', {
            cause: exceptionMessage(error),
          }),
        );
      }
    },
    [fail],
  );

  const cancelCapture = useCallback(async () => {
    const captureId = activeCaptureRef.current;
    if (!captureId) return false;
    try {
      const response = await window.sitepull.cancelCapture({ captureId });
      if (!response.ok) {
        fail(response.error);
        return false;
      }
      return response.data.cancellationRequested;
    } catch (error) {
      fail(
        internalError('The cancellation request could not be sent.', {
          cause: exceptionMessage(error),
        }),
      );
      return false;
    }
  }, [fail]);

  const openRecent = useCallback(
    async (captureId: string) => {
      setModel((current) => ({
        ...current,
        recentsError: null,
        error: null,
        lastRequest: null,
      }));
      await loadManifest(captureId);
    },
    [loadManifest],
  );

  const goHome = useCallback(() => {
    viewGenerationRef.current += 1;
    activeCaptureRef.current = null;
    startingRef.current = false;
    terminalCaptureRef.current = null;
    setModel((current) => ({
      ...current,
      screen: 'empty',
      session: null,
      manifest: null,
      error: null,
      lastRequest: null,
    }));
  }, []);

  const retry = useCallback(() => {
    if (model.lastRequest) void startCapture(model.lastRequest);
  }, [model.lastRequest, startCapture]);

  const exportCapture = useCallback(
    async (mode: ExportMode) => {
      const captureId = model.manifest?.captureId;
      if (!captureId) return null;
      return window.sitepull.exportCapture({ captureId, mode });
    },
    [model.manifest?.captureId],
  );

  const invokeSystemAction = useCallback(
    async (action: 'open' | 'reveal' | 'copy'): Promise<IpcResult<SystemActionResult> | null> => {
      const captureId = model.manifest?.captureId;
      if (!captureId) return null;
      if (action === 'open') return window.sitepull.openCaptureFolder({ captureId });
      if (action === 'reveal') return window.sitepull.revealCaptureInFinder({ captureId });
      return window.sitepull.copyAiContext({ captureId });
    },
    [model.manifest?.captureId],
  );

  const selectOutputDirectory = useCallback(() => window.sitepull.selectOutputDirectory(), []);

  const readCaptureFile = useCallback(
    (relativePath: string) => {
      const captureId = model.manifest?.captureId;
      if (!captureId) return Promise.resolve(null);
      return window.sitepull.readCaptureFile({ captureId, relativePath, maxBytes: 1_048_576 });
    },
    [model.manifest?.captureId],
  );

  return {
    model,
    startCapture,
    cancelCapture,
    openRecent,
    goHome,
    retry,
    exportCapture,
    invokeSystemAction,
    selectOutputDirectory,
    readCaptureFile,
    refreshRecents: loadRecents,
  };
}

export type SitepullController = ReturnType<typeof useSitepull>;
export type LoadedCapture = CaptureManifest;

function eventStartTime(event: CaptureEvent): number {
  const eventTime = new Date(event.timestamp).getTime();
  if (!Number.isFinite(eventTime)) return Date.now();
  return event.type === 'progress' ? eventTime - event.elapsedMs : eventTime;
}
