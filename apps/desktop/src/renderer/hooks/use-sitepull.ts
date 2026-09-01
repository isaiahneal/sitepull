import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CAPTURE_EVENT_REPLAY_LIMIT,
  proxyPoolRecipeFromRequest,
  type CaptureEvent,
  type CaptureJobSnapshot,
  type CaptureManifest,
  type CaptureRecipe,
  type ExportMode,
  type IpcResult,
  type ProxyPoolRecipe,
  type ProxyPoolRequest,
  type SerializedSitepullError,
  type SystemActionResult,
} from '@sitepull/contracts';

import type {
  AppModel,
  CaptureSession,
  SafeCaptureRequest,
  StartCaptureOptions,
} from '../types.js';

const INITIAL_MODEL: AppModel = {
  screen: 'empty',
  recents: [],
  recentsLoading: true,
  recentsError: null,
  lastUsedRecipe: null,
  draftRecipe: null,
  viewRecipe: null,
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
  const localStartPendingRef = useRef(false);
  const terminalCaptureRef = useRef<string | null>(null);
  const pendingEventsRef = useRef<CaptureEvent[]>([]);
  const viewGenerationRef = useRef(0);
  const recentsRequestRef = useRef(0);
  const reconcileRequestRef = useRef(0);
  /** Request-only proxy secrets available solely to Retry in this renderer session. */
  const retryRequestRef = useRef<StartCaptureOptions | null>(null);

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
        lastUsedRecipe: response.data.lastUsedRecipe,
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

  const handleTerminalEvent = useCallback(
    (event: CaptureEvent) => {
      if (event.type !== 'complete' && event.type !== 'error') return;
      if (terminalCaptureRef.current === event.captureId) return;

      terminalCaptureRef.current = event.captureId;
      startingRef.current = false;
      if (event.type === 'complete') {
        retryRequestRef.current = null;
        void loadManifest(event.captureId).then(loadRecents);
      } else {
        fail(event.error);
        void loadRecents();
      }
    },
    [fail, loadManifest, loadRecents],
  );

  const mergeOwnedEvents = useCallback(
    (captureId: string, events: readonly CaptureEvent[], recipe?: CaptureRecipe) => {
      setModel((current) => ({
        ...current,
        ...(recipe === undefined
          ? {}
          : {
              screen: 'capturing' as const,
              manifest: null,
              error: null,
              lastRequest: cloneRecipe(recipe),
              lastUsedRecipe: cloneRecipe(recipe),
              draftRecipe: null,
              viewRecipe: cloneRecipe(recipe),
            }),
        session: mergeCaptureSession(current.session, captureId, events),
      }));
    },
    [],
  );

  useEffect(() => {
    const unsubscribe = window.sitepull.onCaptureEvent((event) => {
      if (startingRef.current && activeCaptureRef.current === null) {
        activeCaptureRef.current = event.captureId;
        startingRef.current = false;
      }
      if (event.captureId !== activeCaptureRef.current) {
        if (terminalCaptureRef.current !== event.captureId) {
          pendingEventsRef.current = [...pendingEventsRef.current, event].slice(
            -CAPTURE_EVENT_REPLAY_LIMIT,
          );
        }
        return;
      }

      mergeOwnedEvents(event.captureId, [event]);
      handleTerminalEvent(event);
    });
    return unsubscribe;
  }, [handleTerminalEvent, mergeOwnedEvents]);

  const reconcileCaptureJob = useCallback(async () => {
    if (localStartPendingRef.current) return;
    const request = ++reconcileRequestRef.current;
    const generation = viewGenerationRef.current;
    try {
      const response = await window.sitepull.getCaptureJob();
      if (request !== reconcileRequestRef.current || generation !== viewGenerationRef.current)
        return;
      if (!response.ok || response.data === null) return;

      const snapshot = response.data;
      if (snapshot.captureId !== null && snapshot.captureId === terminalCaptureRef.current) {
        return;
      }

      const buffered = pendingEventsForSnapshot(snapshot, pendingEventsRef.current);
      const captureId = snapshot.captureId ?? buffered[0]?.captureId ?? null;
      if (captureId === null) {
        startingRef.current = true;
        activeCaptureRef.current = null;
        setModel((current) => ({
          ...current,
          screen: 'capturing',
          manifest: null,
          error: null,
          lastRequest: cloneRecipe(snapshot.recipe),
          lastUsedRecipe: cloneRecipe(snapshot.recipe),
          draftRecipe: null,
          viewRecipe: cloneRecipe(snapshot.recipe),
          session: null,
        }));
        return;
      }

      pendingEventsRef.current = pendingEventsRef.current.filter(
        (event) => event.captureId !== captureId,
      );
      startingRef.current = false;
      activeCaptureRef.current = captureId;
      const events = mergeCaptureEvents(snapshot.events, buffered);
      mergeOwnedEvents(captureId, events, snapshot.recipe);
      const terminal = events.at(-1);
      if (terminal !== undefined) handleTerminalEvent(terminal);
    } catch {
      // Live delivery remains authoritative while reconciliation is unavailable.
    }
  }, [handleTerminalEvent, mergeOwnedEvents]);

  useEffect(() => {
    const reconcileOnFocus = () => void reconcileCaptureJob();
    void reconcileCaptureJob();
    window.addEventListener('focus', reconcileOnFocus);
    return () => window.removeEventListener('focus', reconcileOnFocus);
  }, [reconcileCaptureJob]);

  const startCapture = useCallback(
    async (options: StartCaptureOptions) => {
      const generation = ++viewGenerationRef.current;
      retryRequestRef.current = cloneStartCaptureOptions(options);
      startingRef.current = true;
      localStartPendingRef.current = true;
      activeCaptureRef.current = null;
      pendingEventsRef.current = [];
      setModel((current) => ({
        ...current,
        screen: 'capturing',
        manifest: null,
        error: null,
        lastRequest: safeCaptureRequest(options),
        draftRecipe: null,
        viewRecipe: null,
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
          ...(options.proxyPool === undefined ? {} : { proxyPool: options.proxyPool }),
        });
        localStartPendingRef.current = false;
        if (!response.ok) {
          if (generation !== viewGenerationRef.current) return;
          fail(response.error);
          return;
        }

        if (terminalCaptureRef.current === response.data.captureId) {
          startingRef.current = false;
          setModel((current) => ({
            ...current,
            lastUsedRecipe: cloneRecipe(response.data.recipe),
            viewRecipe: cloneRecipe(response.data.recipe),
          }));
          return;
        }
        if (generation !== viewGenerationRef.current) return;
        // Keep the prior terminal identifier until main confirms a new job.
        // This prevents a rejected pre-start request from re-adopting the old
        // terminal snapshot on the next focus reconciliation.
        terminalCaptureRef.current = null;
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
          lastUsedRecipe: cloneRecipe(response.data.recipe),
          viewRecipe: cloneRecipe(response.data.recipe),
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
        localStartPendingRef.current = false;
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
      retryRequestRef.current = null;
      setModel((current) => ({
        ...current,
        recentsError: null,
        error: null,
        lastRequest: null,
        draftRecipe: null,
        viewRecipe: cloneOptionalRecipe(
          current.recents.find((recent) => recent.captureId === captureId)?.recipe ?? null,
        ),
      }));
      await loadManifest(captureId);
    },
    [loadManifest],
  );

  const goHome = useCallback(() => {
    retryRequestRef.current = null;
    viewGenerationRef.current += 1;
    reconcileRequestRef.current += 1;
    activeCaptureRef.current = null;
    startingRef.current = false;
    localStartPendingRef.current = false;
    pendingEventsRef.current = [];
    setModel((current) => ({
      ...current,
      screen: 'empty',
      session: null,
      manifest: null,
      error: null,
      lastRequest: null,
      draftRecipe: null,
      viewRecipe: null,
    }));
  }, []);

  const prepareCaptureAgain = useCallback((recipe: CaptureRecipe) => {
    retryRequestRef.current = null;
    viewGenerationRef.current += 1;
    reconcileRequestRef.current += 1;
    activeCaptureRef.current = null;
    startingRef.current = false;
    localStartPendingRef.current = false;
    pendingEventsRef.current = [];
    setModel((current) => ({
      ...current,
      screen: 'empty',
      draftRecipe: cloneRecipe(recipe),
      viewRecipe: null,
      session: null,
      manifest: null,
      error: null,
      lastRequest: null,
    }));
  }, []);

  const retry = useCallback(() => {
    const request = retryRequestRef.current;
    if (request !== null) void startCapture(cloneStartCaptureOptions(request));
  }, [startCapture]);

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
    canRetry: model.screen === 'error' && retryRequestRef.current !== null,
    startCapture,
    cancelCapture,
    openRecent,
    goHome,
    prepareCaptureAgain,
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
  const eventTime = new Date(
    event.type === 'complete' ? event.result.startedAt : event.timestamp,
  ).getTime();
  if (!Number.isFinite(eventTime)) return Date.now();
  return event.type === 'progress' ? eventTime - event.elapsedMs : eventTime;
}

function pendingEventsForSnapshot(
  snapshot: CaptureJobSnapshot,
  pendingEvents: readonly CaptureEvent[],
): CaptureEvent[] {
  if (snapshot.captureId !== null) {
    return pendingEvents.filter((event) => event.captureId === snapshot.captureId);
  }
  const captureId = pendingEvents[0]?.captureId;
  return captureId === undefined
    ? []
    : pendingEvents.filter((event) => event.captureId === captureId);
}

function mergeCaptureEvents(
  currentEvents: readonly CaptureEvent[],
  incomingEvents: readonly CaptureEvent[],
): CaptureEvent[] {
  const captureId = incomingEvents[0]?.captureId ?? currentEvents[0]?.captureId;
  if (captureId === undefined) return [];

  const bySequence = new Map<number, CaptureEvent>();
  for (const event of [...currentEvents, ...incomingEvents]) {
    if (event.captureId === captureId) bySequence.set(event.sequence, event);
  }
  return [...bySequence.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-CAPTURE_EVENT_REPLAY_LIMIT);
}

function mergeCaptureSession(
  current: CaptureSession | null,
  captureId: string,
  incomingEvents: readonly CaptureEvent[],
): CaptureSession {
  const currentEvents = current?.captureId === captureId ? current.events : [];
  const events = mergeCaptureEvents(currentEvents, incomingEvents);
  let progress: CaptureSession['progress'] = null;
  for (const event of events) {
    if (event.type === 'progress') progress = event;
  }
  const logs = events.filter((event) => event.type === 'log').slice(-500);
  const replayStartedAt = events[0] === undefined ? Date.now() : eventStartTime(events[0]);
  return {
    captureId,
    progress,
    logs,
    events,
    startedAt:
      current?.captureId === captureId
        ? Math.min(current.startedAt, replayStartedAt)
        : replayStartedAt,
  };
}

function cloneRecipe(recipe: CaptureRecipe): CaptureRecipe {
  return {
    ...recipe,
    config: {
      ...recipe.config,
      viewports: recipe.config.viewports.map((viewport) => ({ ...viewport })),
    },
    proxyPool: cloneProxyPoolRecipe(recipe.proxyPool),
  };
}

function cloneOptionalRecipe(recipe: CaptureRecipe | null): CaptureRecipe | null {
  return recipe === null ? null : cloneRecipe(recipe);
}

function cloneProxyPoolRecipe(proxyPool: ProxyPoolRecipe | null): ProxyPoolRecipe | null {
  if (proxyPool === null) return null;
  return {
    ...proxyPool,
    entries: proxyPool.entries.map((entry) => ({ ...entry })),
    jitter: { ...proxyPool.jitter },
  };
}

function cloneProxyPoolRequest(
  proxyPool: ProxyPoolRequest | undefined,
): ProxyPoolRequest | undefined {
  if (proxyPool === undefined) return undefined;
  return {
    ...proxyPool,
    entries: proxyPool.entries.map((entry) => ({
      server: entry.server,
      ...(entry.credentials === undefined ? {} : { credentials: { ...entry.credentials } }),
    })),
    jitter: { ...proxyPool.jitter },
  };
}

function cloneStartCaptureOptions(options: StartCaptureOptions): StartCaptureOptions {
  const proxyPool = cloneProxyPoolRequest(options.proxyPool);
  return {
    ...options,
    config: {
      ...options.config,
      viewports: options.config.viewports.map((viewport) => ({ ...viewport })),
    },
    ...(proxyPool === undefined ? {} : { proxyPool }),
  };
}

function safeCaptureRequest(options: StartCaptureOptions): SafeCaptureRequest {
  return {
    url: options.url,
    ...(options.allowHttpFallback === undefined
      ? {}
      : { allowHttpFallback: options.allowHttpFallback }),
    ...(options.outputDirectory === undefined ? {} : { outputDirectory: options.outputDirectory }),
    config: {
      ...options.config,
      viewports: options.config.viewports.map((viewport) => ({ ...viewport })),
    },
    proxyPool:
      options.proxyPool === undefined ? null : proxyPoolRecipeFromRequest(options.proxyPool),
  };
}
