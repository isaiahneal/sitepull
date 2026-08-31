#!/usr/bin/env node
/* global document */

import { createRequire } from 'node:module';
import { readFile, readlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const installationRoot = process.env.SITEPULL_CLI_ROOT || '/usr/lib/sitepull-cli';
const executablePath = process.env.SITEPULL_CHROMIUM?.trim();
if (executablePath === undefined || executablePath === '') {
  throw new Error('SITEPULL_CHROMIUM must name the installed Chromium executable to audit.');
}
const require = createRequire(`${installationRoot}/package.json`);
const { chromium } = require('playwright');
const core = await import(
  pathToFileURL(`${installationRoot}/node_modules/@sitepull/core/dist/index.js`).href
);

function statusValue(status, name) {
  const match = status.match(new RegExp(`^${name}:\\s*(.+)$`, 'mu'));
  if (match === null) throw new Error(`Linux did not report ${name} for a Chromium process.`);
  return match[1].trim();
}

function assertNoUnsafeGraphics(commandLine, processName) {
  const normalized = commandLine.join(' ').toLowerCase();
  for (const forbiddenGraphicsArgument of [
    'swiftshader',
    '--use-angle',
    '--enable-unsafe-swiftshader',
  ]) {
    if (normalized.includes(forbiddenGraphicsArgument)) {
      throw new Error(
        `${processName} selected forbidden software graphics argument ${forbiddenGraphicsArgument}.`,
      );
    }
  }
}

function assertInnerSeccompFilter(browserStatus, childStatus, processName) {
  const browserSeccomp = statusValue(browserStatus, 'Seccomp');
  const seccomp = statusValue(childStatus, 'Seccomp');
  const noNewPrivileges = statusValue(childStatus, 'NoNewPrivs');
  const browserSeccompFilters = Number(statusValue(browserStatus, 'Seccomp_filters'));
  const childSeccompFilters = Number(statusValue(childStatus, 'Seccomp_filters'));
  if (
    browserSeccomp !== '2' ||
    !Number.isSafeInteger(browserSeccompFilters) ||
    browserSeccompFilters < 1
  ) {
    throw new Error(
      `The outer Chromium process is missing its expected seccomp boundary (Seccomp=${browserSeccomp}, filters=${browserSeccompFilters}).`,
    );
  }
  if (seccomp !== '2') {
    throw new Error(`${processName} did not enable seccomp filtering (Seccomp=${seccomp}).`);
  }
  if (noNewPrivileges !== '1') {
    throw new Error(
      `${processName} did not enable the no-new-privileges boundary (NoNewPrivs=${noNewPrivileges}).`,
    );
  }
  if (!Number.isSafeInteger(childSeccompFilters) || childSeccompFilters <= browserSeccompFilters) {
    throw new Error(
      `${processName} did not add its own seccomp policy (browser=${browserSeccompFilters}, child=${childSeccompFilters}).`,
    );
  }
  return { seccomp, noNewPrivileges, seccompFilters: childSeccompFilters };
}

function assertSandboxedProcesses({
  browserCommandLine,
  gpuCommandLine,
  browserStatus,
  rendererStatus,
  gpuStatus,
  browserNetworkNamespace,
  rendererNetworkNamespace,
  browserPidNamespace,
  rendererPidNamespace,
  browserUserNamespace,
  rendererUserNamespace,
}) {
  const forbiddenSwitches = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-seccomp-filter-sandbox',
    '--disable-namespace-sandbox',
  ];
  for (const forbiddenSwitch of forbiddenSwitches) {
    if (
      browserCommandLine.some(
        (argument) => argument === forbiddenSwitch || argument.startsWith(`${forbiddenSwitch}=`),
      )
    ) {
      throw new Error(`Chromium was launched with forbidden switch ${forbiddenSwitch}.`);
    }
  }
  assertNoUnsafeGraphics(browserCommandLine, 'Chromium browser');
  assertNoUnsafeGraphics(gpuCommandLine, 'Chromium GPU process');

  const rendererSandbox = assertInnerSeccompFilter(
    browserStatus,
    rendererStatus,
    'Chromium renderer',
  );
  const gpuSandbox = assertInnerSeccompFilter(browserStatus, gpuStatus, 'Chromium GPU process');
  const nestedProcessIds = statusValue(rendererStatus, 'NSpid').split(/\s+/u);
  if (nestedProcessIds.length < 2) {
    throw new Error('Chromium renderer did not enter a nested PID namespace.');
  }
  if (rendererPidNamespace === browserPidNamespace) {
    throw new Error('Chromium renderer did not enter an isolated PID namespace.');
  }
  if (rendererNetworkNamespace === browserNetworkNamespace) {
    throw new Error('Chromium renderer did not enter an isolated network namespace.');
  }
  if (rendererUserNamespace === browserUserNamespace) {
    throw new Error('Chromium renderer did not enter an isolated user namespace.');
  }

  return {
    rendererSeccomp: rendererSandbox.seccomp,
    rendererSeccompFilters: rendererSandbox.seccompFilters,
    rendererNoNewPrivileges: rendererSandbox.noNewPrivileges,
    gpuSeccomp: gpuSandbox.seccomp,
    gpuSeccompFilters: gpuSandbox.seccompFilters,
    gpuNoNewPrivileges: gpuSandbox.noNewPrivileges,
    nestedPidDepth: nestedProcessIds.length,
    isolatedPidNamespace: true,
    isolatedNetworkNamespace: true,
    isolatedUserNamespace: true,
  };
}

let browser;
try {
  browser = await chromium.launch({
    ...core.untrustedBrowserLaunchOptions('chromium', false, { systemChromium: true }),
    executablePath,
  });
  const page = await browser.newPage();
  await page.setContent(
    '<!doctype html><title>Sitepull sandbox probe</title><main>ready</main><canvas></canvas>',
  );
  if ((await page.title()) !== 'Sitepull sandbox probe') {
    throw new Error('Chromium renderer did not complete the sandbox probe page.');
  }
  const graphicsStatus = await page.evaluate(() => {
    const canvas2d = document.createElement('canvas');
    const context2d = canvas2d.getContext('2d');
    context2d?.fillRect(0, 0, 10, 10);
    return {
      canvas2d: context2d !== null,
      webgl: document.createElement('canvas').getContext('webgl') !== null,
      webgl2: document.createElement('canvas').getContext('webgl2') !== null,
    };
  });
  if (!graphicsStatus.canvas2d || graphicsStatus.webgl || graphicsStatus.webgl2) {
    throw new Error(
      `Chromium graphics policy is not fail-closed: ${JSON.stringify(graphicsStatus)}`,
    );
  }
  const screenshot = await page.screenshot();
  if (screenshot.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Chromium did not produce a valid PNG during the sandbox probe.');
  }

  const session = await browser.newBrowserCDPSession();
  const { processInfo } = await session.send('SystemInfo.getProcessInfo');
  await session.detach();
  const browserProcess = processInfo.find(({ type }) => type === 'browser');
  const rendererProcess = processInfo.find(({ type }) => type === 'renderer');
  const gpuProcess = processInfo.find(({ type }) => type.toLowerCase() === 'gpu');
  if (browserProcess === undefined || rendererProcess === undefined || gpuProcess === undefined) {
    throw new Error(
      `Chromium did not report browser, renderer, and GPU processes: ${JSON.stringify(processInfo)}`,
    );
  }

  const [
    browserCommandLineBuffer,
    gpuCommandLineBuffer,
    browserStatus,
    rendererStatus,
    gpuStatus,
    browserNetworkNamespace,
    rendererNetworkNamespace,
    browserPidNamespace,
    rendererPidNamespace,
    browserUserNamespace,
    rendererUserNamespace,
  ] = await Promise.all([
    readFile(`/proc/${browserProcess.id}/cmdline`),
    readFile(`/proc/${gpuProcess.id}/cmdline`),
    readFile(`/proc/${browserProcess.id}/status`, 'utf8'),
    readFile(`/proc/${rendererProcess.id}/status`, 'utf8'),
    readFile(`/proc/${gpuProcess.id}/status`, 'utf8'),
    readlink(`/proc/${browserProcess.id}/ns/net`),
    readlink(`/proc/${rendererProcess.id}/ns/net`),
    readlink(`/proc/${browserProcess.id}/ns/pid`),
    readlink(`/proc/${rendererProcess.id}/ns/pid`),
    readlink(`/proc/${browserProcess.id}/ns/user`),
    readlink(`/proc/${rendererProcess.id}/ns/user`),
  ]);
  const status = assertSandboxedProcesses({
    browserCommandLine: browserCommandLineBuffer.toString('utf8').split('\0'),
    gpuCommandLine: gpuCommandLineBuffer.toString('utf8').split('\0'),
    browserStatus,
    rendererStatus,
    gpuStatus,
    browserNetworkNamespace,
    rendererNetworkNamespace,
    browserPidNamespace,
    rendererPidNamespace,
    browserUserNamespace,
    rendererUserNamespace,
  });
  process.stdout.write(`Chromium process sandbox: ${JSON.stringify(status)}\n`);
} finally {
  await browser?.close();
}
