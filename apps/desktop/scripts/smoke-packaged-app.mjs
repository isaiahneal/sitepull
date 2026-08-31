import { execFile, spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';

const execFileAsync = promisify(execFile);
const desktopRoot = path.resolve(import.meta.dirname, '..');
const outputRoot = path.join(desktopRoot, 'out');
const makeRoot = path.join(outputRoot, 'make');
const platformName = process.platform;
const packageDirectory = path.resolve(
  process.env.SITEPULL_PACKAGE_DIRECTORY ??
    path.join(outputRoot, `Sitepull-${platformName}-${process.arch}`),
);
const smokeTimeoutMs = 30_000;
const desktopVersion = JSON.parse(
  await readFile(path.join(desktopRoot, 'package.json'), 'utf8'),
).version;
if (typeof desktopVersion !== 'string' || desktopVersion === '') {
  throw new Error('Desktop package version is missing.');
}

function packagedLayout() {
  if (platformName === 'darwin') {
    const application = path.join(packageDirectory, 'Sitepull.app');
    return {
      application,
      executable: path.join(application, 'Contents', 'MacOS', 'Sitepull'),
      resources: path.join(application, 'Contents', 'Resources'),
      fuseTarget: application,
    };
  }
  return {
    application: packageDirectory,
    executable: path.join(packageDirectory, platformName === 'win32' ? 'Sitepull.exe' : 'Sitepull'),
    resources: path.join(packageDirectory, 'resources'),
    fuseTarget: path.join(packageDirectory, platformName === 'win32' ? 'Sitepull.exe' : 'Sitepull'),
  };
}

async function assertFile(filePath, label) {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error(`${label} is missing or empty: ${filePath}`);
  }
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function verifyMakerOutputs() {
  const artifacts = await filesBelow(makeRoot);
  const expectations =
    platformName === 'darwin'
      ? [
          ['DMG', (file) => file.endsWith('.dmg')],
          ['ZIP', (file) => file.endsWith(`-${desktopVersion}.zip`)],
        ]
      : platformName === 'linux'
        ? [['DEB', (file) => file.includes(desktopVersion) && file.endsWith('.deb')]]
        : [
            ['Squirrel setup executable', (file) => file.endsWith('Setup.exe')],
            [
              'Squirrel package',
              (file) => file.includes(desktopVersion) && file.endsWith('.nupkg'),
            ],
            ['Squirrel RELEASES index', (file) => path.basename(file) === 'RELEASES'],
            ['ZIP', (file) => file.endsWith(`-${desktopVersion}.zip`)],
          ];

  for (const [label, matches] of expectations) {
    const artifact = artifacts.find(matches);
    if (artifact === undefined)
      throw new Error(`The native make did not produce a ${label} artifact.`);
    await assertFile(artifact, label);
  }
  console.log(
    `Native maker outputs verified (${expectations.map(([label]) => label).join(', ')}).`,
  );
}

async function verifyFuses(fuseTarget) {
  const fuseWire = await getCurrentFuseWire(fuseTarget);
  const expectedStates = [
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  ];
  for (const [option, expected] of expectedStates) {
    const actual = fuseWire[option];
    if (actual !== expected) {
      throw new Error(
        `Unexpected ${FuseV1Options[option]} fuse state: expected ${FuseState[expected]}, received ${FuseState[actual] ?? actual}.`,
      );
    }
  }
  console.log('Packaged Electron security fuses verified.');
}

async function verifyMacSignature(application) {
  if (platformName !== 'darwin') return;
  await execFileAsync(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', application],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  console.log('macOS bundle passes strict deep signature verification.');
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function smokePackagedWebKit(resources) {
  const browserRoot = await realpath(path.join(resources, '.playwright-browsers'));
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
  const { webkit } = await import('playwright');
  const executable = await realpath(webkit.executablePath());
  if (!isPathInside(browserRoot, executable)) {
    throw new Error(`Playwright resolved WebKit outside packaged Resources: ${executable}`);
  }
  await access(executable, fsConstants.X_OK);

  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main data-sitepull-smoke="ready">Packaged WebKit ready</main>');
    const result = await page.locator('[data-sitepull-smoke="ready"]').textContent();
    if (result !== 'Packaged WebKit ready') {
      throw new Error('Packaged WebKit did not render the smoke document correctly.');
    }
  } finally {
    await browser.close();
  }
  console.log(`Packaged WebKit launched successfully: ${executable}`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Could not reserve a loopback port for the packaged renderer smoke test.');
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function outputCollector(stream) {
  let output = '';
  stream?.setEncoding('utf8');
  stream?.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-16_384);
  });
  return () => output.trim();
}

async function terminateProcessTree(child) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (platformName === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(
      () => undefined,
    );
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await delay(1_000);
  if (child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

async function waitForDevtoolsEndpoint(port, exitState) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + smokeTimeoutMs;
  while (Date.now() < deadline) {
    if (exitState.value !== null) {
      throw new Error(`Packaged application exited before renderer startup (${exitState.value}).`);
    }
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return endpoint;
    } catch {
      // The DevTools endpoint is unavailable until Electron finishes starting.
    }
    await delay(250);
  }
  throw new Error(`Packaged renderer did not start within ${smokeTimeoutMs} ms.`);
}

async function smokePackagedRenderer(executable) {
  const port = await reserveLoopbackPort();
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), 'sitepull-packaged-smoke-'));
  const electronArguments = [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(profileRoot, 'electron-profile')}`,
    '--enable-logging=stderr',
  ];
  const command = platformName === 'linux' ? 'xvfb-run' : executable;
  const args =
    platformName === 'linux'
      ? [
          '--auto-servernum',
          '--server-args=-screen 0 1280x800x24',
          executable,
          ...electronArguments,
        ]
      : electronArguments;
  const child = spawn(command, args, {
    cwd: packageDirectory,
    detached: platformName !== 'win32',
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      SITEPULL_PACKAGED_RUNTIME_SMOKE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout = outputCollector(child.stdout);
  const stderr = outputCollector(child.stderr);
  const exitState = { value: null };
  child.once('error', (error) => {
    exitState.value = `spawn error: ${error.message}`;
  });
  child.once('exit', (code, signal) => {
    exitState.value = signal === null ? `exit ${code ?? 'unknown'}` : `signal ${signal}`;
  });

  try {
    const endpoint = await waitForDevtoolsEndpoint(port, exitState);
    const { chromium } = await import('playwright');
    const browser = await chromium.connectOverCDP(endpoint);
    try {
      const deadline = Date.now() + smokeTimeoutMs;
      let rendererPage;
      while (rendererPage === undefined && Date.now() < deadline) {
        rendererPage = browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => page.url().startsWith('file:'));
        if (rendererPage === undefined) await delay(100);
      }
      if (rendererPage === undefined)
        throw new Error('Electron exposed no packaged renderer page.');
      await rendererPage
        .locator('#root > *')
        .first()
        .waitFor({ state: 'attached', timeout: 15_000 });
      const renderer = await rendererPage.evaluate(async () => {
        const api = globalThis.sitepull;
        const [recents, captureJob] =
          api === undefined
            ? [null, null]
            : await Promise.all([api.listRecents(), api.getCaptureJob()]);
        const privateNetworkCapture =
          api === undefined
            ? null
            : await api.startCapture({
                url: 'https://127.0.0.1/',
                allowHttpFallback: false,
              });
        return {
          title: globalThis.document.title,
          readyState: globalThis.document.readyState,
          rootChildren: globalThis.document.querySelector('#root')?.childElementCount ?? 0,
          url: globalThis.location.href,
          bridgeMethods: api === undefined ? [] : Object.keys(api).sort(),
          recents,
          captureJob,
          privateNetworkCapture,
        };
      });
      if (
        renderer.title !== 'Sitepull' ||
        renderer.readyState === 'loading' ||
        renderer.rootChildren === 0 ||
        !renderer.url.endsWith('/index.html') ||
        renderer.bridgeMethods.length === 0 ||
        renderer.recents?.ok !== true ||
        !Array.isArray(renderer.recents.data.captures) ||
        renderer.captureJob?.ok !== true ||
        renderer.captureJob.data !== null ||
        renderer.privateNetworkCapture?.ok !== false ||
        renderer.privateNetworkCapture.error.code !== 'PRIVATE_NETWORK_BLOCKED'
      ) {
        throw new Error(
          `Packaged renderer failed its readiness assertion: ${JSON.stringify(renderer)}`,
        );
      }
      console.log(`Packaged renderer loaded successfully: ${renderer.url}`);
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch (error) {
    const diagnostics = [stdout(), stderr()].filter((value) => value !== '').join('\n');
    if (diagnostics !== '') console.error(`Packaged application diagnostics:\n${diagnostics}`);
    throw error;
  } finally {
    await terminateProcessTree(child);
    await rm(profileRoot, { recursive: true, force: true });
  }
}

const layout = packagedLayout();
await assertFile(layout.executable, 'Packaged Sitepull executable');
await verifyMakerOutputs();
await verifyFuses(layout.fuseTarget);
await verifyMacSignature(layout.application);
await smokePackagedWebKit(layout.resources);
await smokePackagedRenderer(layout.executable);
console.log(`Packaged Sitepull smoke test passed for ${platformName}-${process.arch}.`);
