import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  app,
  BrowserWindow,
  net,
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';

import type { CaptureRegistry } from './capture-registry.js';
import { isCaptureScreenshotSafeToDecode } from './capture-image.js';
import { CAPTURE_SCHEME, parseCaptureScreenshotUrl } from './capture-url.js';
import { desktopWindowChrome, desktopWindowIconPath } from './platform.js';

export const RENDERER_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: sitepull-capture:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'none'",
  "worker-src 'none'",
].join('; ');

function activeRendererCsp(): string {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL === undefined) return RENDERER_CSP;
  const devServer = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  const websocketProtocol = devServer.protocol === 'https:' ? 'wss:' : 'ws:';
  const websocketOrigin = `${websocketProtocol}//${devServer.host}`;
  return RENDERER_CSP.replace("connect-src 'self'", `connect-src 'self' ${websocketOrigin}`);
}

export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CAPTURE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
      },
    },
  ]);
}

function rendererEntryUrl(): string {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL !== undefined) {
    return new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).href;
  }
  return pathToFileURL(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
    .href;
}

function safeExternalUrl(input: string): string | null {
  if (input.length > 8_192) return null;
  try {
    const url = new URL(input);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function openExternalIfSafe(input: string): void {
  const url = safeExternalUrl(input);
  if (url !== null) void shell.openExternal(url).catch(() => undefined);
}

export function createSecureWindow(): BrowserWindow {
  const iconPath = desktopWindowIconPath(app.isPackaged, process.resourcesPath, app.getAppPath());
  const window = new BrowserWindow({
    width: 1_280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Sitepull',
    ...desktopWindowChrome(process.platform, iconPath),
    backgroundColor: '#0b0c0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  const trustedEntry = rendererEntryUrl();
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url === trustedEntry) return;
    event.preventDefault();
    openExternalIfSafe(url);
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (url === trustedEntry) return;
    event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  return window;
}

export async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL !== undefined) {
    await window.loadURL(rendererEntryUrl());
  } else {
    await window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

export function installSessionSecurity(getMainWindow: () => BrowserWindow | null): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setDevicePermissionHandler(() => false);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const window = getMainWindow();
    if (window === null || details.webContentsId !== window.webContents.id) {
      callback(
        details.responseHeaders === undefined ? {} : { responseHeaders: details.responseHeaders },
      );
      return;
    }
    const responseHeaders = { ...(details.responseHeaders ?? {}) };
    for (const name of Object.keys(responseHeaders)) {
      if (name.toLowerCase() === 'content-security-policy') delete responseHeaders[name];
    }
    responseHeaders['Content-Security-Policy'] = [activeRendererCsp()];
    responseHeaders['X-Content-Type-Options'] = ['nosniff'];
    callback({ responseHeaders });
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
): void {
  const window = getMainWindow();
  const expectedUrl = rendererEntryUrl();
  if (
    window === null ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== expectedUrl ||
    event.sender.getURL() !== expectedUrl
  ) {
    throw new Error('Rejected IPC from an unauthorized sender.');
  }
}

export function installCaptureProtocol(registry: CaptureRegistry): void {
  protocol.handle(CAPTURE_SCHEME, async (request) => {
    const parsed = parseCaptureScreenshotUrl(request.url);
    if (parsed === null) return new Response('Not found', { status: 404 });

    try {
      const screenshotPath = await registry.resolveRelative(parsed.captureId, parsed.relativePath);
      const screenshotStats = await stat(screenshotPath);
      if (
        !screenshotStats.isFile() ||
        screenshotStats.size > 100 * 1024 * 1024 ||
        !(await isCaptureScreenshotSafeToDecode(screenshotPath))
      ) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(screenshotPath).href, {
        bypassCustomProtocolHandlers: true,
      });
    } catch {
      return new Response('Not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    }
  });
}
