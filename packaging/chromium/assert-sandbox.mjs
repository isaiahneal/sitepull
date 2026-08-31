#!/usr/bin/env node

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const installationRoot = process.env.SITEPULL_CLI_ROOT || '/usr/lib/sitepull-cli';
const executablePath = process.env.SITEPULL_CHROMIUM || '/usr/bin/chromium-browser';
const require = createRequire(`${installationRoot}/package.json`);
const { chromium } = require('playwright');
const core = await import(
  pathToFileURL(`${installationRoot}/node_modules/@sitepull/core/dist/index.js`).href
);

let browser;
try {
  browser = await chromium.launch({
    ...core.untrustedBrowserLaunchOptions('chromium', false, { systemChromium: true }),
    executablePath,
  });
  const page = await browser.newPage();
  await page.goto('chrome://sandbox', { waitUntil: 'domcontentloaded' });
  const status = await page.locator('body').innerText();
  process.stdout.write(`${status.trim()}\n`);

  if (!/^Seccomp-BPF sandbox\s+Yes$/mu.test(status)) {
    throw new Error('Chromium did not enable its Seccomp-BPF sandbox.');
  }
  if (!/You are adequately sandboxed\./u.test(status)) {
    throw new Error('Chromium does not consider the installed browser adequately sandboxed.');
  }
} finally {
  await browser?.close();
}
