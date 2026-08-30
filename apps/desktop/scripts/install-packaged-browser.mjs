import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(import.meta.dirname, '..');
const browserRoot = path.join(desktopRoot, '.playwright-browsers');
const playwrightPackage = require.resolve('playwright/package.json');
const playwrightCli = path.join(path.dirname(playwrightPackage), 'cli.js');

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `Playwright browser installation exited with code ${code ?? 'unknown'}.`
            : `Playwright browser installation was terminated by ${signal}.`,
        ),
      );
    });
  });
}

await mkdir(browserRoot, { recursive: true });
await run(process.execPath, [playwrightCli, 'install', 'webkit'], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browserRoot,
  },
  stdio: 'inherit',
  windowsHide: true,
});

process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
const { webkit } = await import('playwright');
const executablePath = path.resolve(webkit.executablePath());
const relativeExecutable = path.relative(browserRoot, executablePath);
if (
  relativeExecutable === '' ||
  relativeExecutable === '..' ||
  relativeExecutable.startsWith(`..${path.sep}`) ||
  path.isAbsolute(relativeExecutable)
) {
  throw new Error(
    `Playwright resolved WebKit outside the packaged browser directory: ${executablePath}`,
  );
}
await access(executablePath);

console.log(`Packaged WebKit ready: ${executablePath}`);
