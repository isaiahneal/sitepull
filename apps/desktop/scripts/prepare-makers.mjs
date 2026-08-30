import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

async function canLoad(entryPoint) {
  try {
    await execFileAsync(process.execPath, ['--eval', 'require(process.argv[1])', entryPoint], {
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function rebuildNativeModule(entryPoint, label, nodeGypCli) {
  if (await canLoad(entryPoint)) return;

  console.log(`Rebuilding ${label} for Node ${process.versions.node} (${process.arch})...`);
  await execFileAsync(process.execPath, [nodeGypCli, 'rebuild'], {
    cwd: path.dirname(entryPoint),
    env: {
      ...process.env,
      npm_config_loglevel: 'warn',
    },
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });

  if (!(await canLoad(entryPoint))) {
    throw new Error(`${label} still cannot load after rebuilding.`);
  }
}

if (process.platform === 'darwin') {
  const makerDmgEntry = require.resolve('@electron-forge/maker-dmg');
  const installerDmgEntry = createRequire(makerDmgEntry).resolve('electron-installer-dmg');
  const appdmgEntry = createRequire(installerDmgEntry).resolve('appdmg');
  const appdmgRequire = createRequire(appdmgEntry);
  const fsXattrEntry = appdmgRequire.resolve('fs-xattr');
  const dsStoreEntry = appdmgRequire.resolve('ds-store');
  const macosAliasEntry = createRequire(dsStoreEntry).resolve('macos-alias');
  const nodeGypCli = require.resolve('@electron/node-gyp/bin/node-gyp.js');

  await rebuildNativeModule(fsXattrEntry, 'fs-xattr', nodeGypCli);
  await rebuildNativeModule(macosAliasEntry, 'macos-alias', nodeGypCli);
}
