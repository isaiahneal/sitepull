import path from 'node:path';

import { app, dialog, protocol, type BrowserWindow } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';

import { CaptureRegistry } from './capture-registry.js';
import { CAPTURE_SCHEME } from './capture-url.js';
import { loadCore } from './core.js';
import { registerDesktopIpc } from './ipc.js';
import { CaptureJobManager } from './job-manager.js';
import { OutputAuthorization } from './output-authorization.js';
import { desktopWindowIconPath, shouldHandleSquirrelStartup, SITEPULL_APP_ID } from './platform.js';
import { RecentsStore } from './recents-store.js';
import {
  createSecureWindow,
  installCaptureProtocol,
  installSessionSecurity,
  loadRenderer,
  registerPrivilegedSchemes,
} from './security.js';

let mainWindow: BrowserWindow | null = null;
let jobs: CaptureJobManager | null = null;
let unregisterIpc: (() => void) | null = null;
let quitPending = false;
let quitAllowed = false;
let initialized = false;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

async function openMainWindow(): Promise<void> {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const window = createSecureWindow();
  mainWindow = window;
  const ownerId = window.webContents.id;
  window.once('closed', () => {
    jobs?.abortForOwner(ownerId);
    if (mainWindow === window) mainWindow = null;
  });
  try {
    await loadRenderer(window);
  } catch (error) {
    window.destroy();
    throw error;
  }
}

async function verifyPackagedBrowserRuntimeIfRequested(): Promise<void> {
  if (!app.isPackaged || process.env.SITEPULL_PACKAGED_RUNTIME_SMOKE === undefined) return;
  const { webkit } = await import('playwright');
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main data-sitepull-runtime="ready">Sitepull runtime ready</main>');
    const ready = await page.locator('[data-sitepull-runtime="ready"]').textContent();
    if (ready !== 'Sitepull runtime ready') {
      throw new Error('The packaged Sitepull WebKit runtime did not render its smoke document.');
    }
  } finally {
    await browser.close();
  }
}

async function bootstrap(): Promise<void> {
  // Fail startup before exposing the UI if the packaged core bundle or its
  // Playwright dependency cannot be loaded from the configured Resources path.
  await loadCore();
  await verifyPackagedBrowserRuntimeIfRequested();
  if (process.env.SITEPULL_PACKAGED_RUNTIME_SMOKE === 'probe-only') {
    app.quit();
    return;
  }

  const iconPath = desktopWindowIconPath(app.isPackaged, process.resourcesPath, app.getAppPath());
  app.setAboutPanelOptions({
    applicationName: 'Sitepull',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Copyright © 2026 Isaiah Neal',
    ...(process.platform === 'darwin' ? {} : { iconPath }),
  });

  installSessionSecurity(getMainWindow);
  const recents = new RecentsStore(path.join(app.getPath('userData'), 'recents.json'));
  const registry = new CaptureRegistry();
  const recentIndex = await recents.list();
  await Promise.all(
    recentIndex.captures
      .filter((capture) => capture.availability === 'available')
      .map((capture) => registry.registerExisting(capture.captureId, capture.outputPath)),
  );
  const persistedOutputDirectories = [
    recentIndex.lastUsedRecipe?.outputDirectory,
    ...recentIndex.captures.map((capture) => capture.recipe?.outputDirectory),
  ].filter((directory): directory is string => directory !== undefined);
  const outputs = await OutputAuthorization.create(
    path.join(app.getPath('documents'), 'Sitepull'),
    persistedOutputDirectories,
  );
  jobs = new CaptureJobManager(registry, recents);
  installCaptureProtocol(registry);
  unregisterIpc = registerDesktopIpc({
    getMainWindow,
    jobs,
    outputs,
    recents,
    registry,
  });
  initialized = true;
  await openMainWindow();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function startDesktopApplication(): void {
  app.setName('Sitepull');
  if (process.platform === 'win32') app.setAppUserModelId(SITEPULL_APP_ID);
  registerPrivilegedSchemes();

  process.env.PLAYWRIGHT_BROWSERS_PATH = app.isPackaged
    ? path.join(process.resourcesPath, '.playwright-browsers')
    : path.join(app.getAppPath(), '.playwright-browsers');

  const ownsInstanceLock = app.requestSingleInstanceLock();
  if (!ownsInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (!initialized) return;
      void openMainWindow().catch(() => undefined);
    });

    app.on('activate', () => {
      if (!initialized) return;
      void openMainWindow().catch(() => undefined);
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });

    app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
      event.preventDefault();
      callback(false);
    });

    app.on('before-quit', (event) => {
      if (quitAllowed || jobs === null || !jobs.hasActiveJobs) return;
      event.preventDefault();
      if (quitPending) return;
      quitPending = true;
      jobs.abortAll();
      void Promise.race([jobs.whenIdle(), wait(10_000)]).finally(() => {
        quitAllowed = true;
        app.quit();
      });
    });

    app.on('will-quit', () => {
      unregisterIpc?.();
      unregisterIpc = null;
      protocol.unhandle(CAPTURE_SCHEME);
    });

    void app
      .whenReady()
      .then(bootstrap)
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        dialog.showErrorBox('Sitepull could not start', detail);
        app.quit();
      });
  }
}

if (shouldHandleSquirrelStartup(process.platform, squirrelStartup)) {
  app.quit();
} else {
  startDesktopApplication();
}
