import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createCommandExclusively,
  copyDeploymentIsolated,
  defaultCliBinDirectory,
  defaultCliDataDirectory,
  installGlobalCli,
  installImmutableDeployment,
  replaceCommandAtomically,
  windowsCliLauncher,
} from './install-global-cli.js';

const temporaryRoots: string[] = [];

async function fixture(): Promise<{ root: string; source: string; bin: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sitepull-global-cli-'));
  temporaryRoots.push(root);
  const source = path.join(root, 'bin.js');
  const bin = path.join(root, 'commands');
  await writeFile(source, '#!/usr/bin/env node\n');
  await chmod(source, 0o755);
  return { root, source, bin };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('global CLI installer', () => {
  it('physically isolates a deployment from pnpm workspace hardlinks', async () => {
    const { root } = await fixture();
    const backingFile = path.join(root, 'workspace-output.js');
    const sourceDirectory = path.join(root, 'pnpm-deployment');
    const sourceFile = path.join(sourceDirectory, 'nested', 'output.js');
    const copiedDirectory = path.join(root, 'isolated-deployment');
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(backingFile, 'before\n');
    await link(backingFile, sourceFile);
    await symlink('nested/output.js', path.join(sourceDirectory, 'output-link.js'));

    await copyDeploymentIsolated(sourceDirectory, copiedDirectory);
    await writeFile(backingFile, 'after\n');

    expect(await readFile(sourceFile, 'utf8')).toBe('after\n');
    expect(await readFile(path.join(copiedDirectory, 'nested', 'output.js'), 'utf8')).toBe(
      'before\n',
    );
    expect(await readlink(path.join(copiedDirectory, 'output-link.js'))).toBe('nested/output.js');
  });

  it('leaves the previous command intact when an atomic cutover fails', async () => {
    const { root, source, bin } = await fixture();
    const destination = path.join(bin, 'sitepull');
    const nextSource = path.join(root, 'next.js');
    await mkdir(bin);
    await writeFile(nextSource, '#!/usr/bin/env node\n');
    await symlink(source, destination);

    await expect(
      replaceCommandAtomically(
        destination,
        (temporaryPath) => symlink(nextSource, temporaryPath),
        () => Promise.reject(new Error('injected cutover failure')),
      ),
    ).rejects.toThrow(/injected cutover failure/u);

    expect(await readlink(destination)).toBe(source);
    expect(await readdir(bin)).toEqual(['sitepull']);
  });

  it('rejects a corrupted third-party dependency in an immutable deployment', async () => {
    const { root } = await fixture();
    const existingDirectory = path.join(root, 'versions', '0.4.0');
    const candidateDirectory = path.join(root, 'candidate');
    for (const directory of [existingDirectory, candidateDirectory]) {
      await mkdir(path.join(directory, 'node_modules', 'cac'), { recursive: true });
      await writeFile(path.join(directory, 'package.json'), '{"version":"0.4.0"}\n');
      await writeFile(path.join(directory, 'node_modules', 'cac', 'index.js'), 'export {};\n');
    }

    await expect(installImmutableDeployment(candidateDirectory, existingDirectory)).resolves.toBe(
      false,
    );
    await writeFile(
      path.join(existingDirectory, 'node_modules', 'cac', 'index.js'),
      'throw new Error("corrupt");\n',
    );
    await expect(installImmutableDeployment(candidateDirectory, existingDirectory)).rejects.toThrow(
      /different contents/u,
    );
  });

  it('never exposes a partial command during exclusive first installation', async () => {
    const { bin } = await fixture();
    const destination = path.join(bin, 'sitepull.cmd');
    await mkdir(bin);

    await expect(
      createCommandExclusively(destination, async (temporaryPath) => {
        await writeFile(temporaryPath, '@ECHO OFF\r\npartial');
        throw new Error('injected write failure');
      }),
    ).rejects.toThrow(/injected write failure/u);

    expect(await readdir(bin)).toEqual([]);
  });

  it('does not clobber a command created concurrently during first installation', async () => {
    const { bin } = await fixture();
    const destination = path.join(bin, 'sitepull.cmd');
    await mkdir(bin);
    await writeFile(destination, 'unrelated\n');

    await expect(
      createCommandExclusively(destination, (temporaryPath) =>
        writeFile(temporaryPath, '@ECHO OFF\r\n', { flag: 'wx' }),
      ),
    ).rejects.toMatchObject({ code: 'EEXIST' });

    expect(await readFile(destination, 'utf8')).toBe('unrelated\n');
    expect(await readdir(bin)).toEqual(['sitepull.cmd']);
  });

  it('chooses conventional per-user command directories', () => {
    expect(defaultCliBinDirectory('darwin', '/Users/test', undefined)).toBe(
      path.join('/Users/test', '.local', 'bin'),
    );
    expect(defaultCliBinDirectory('win32', 'C:\\Users\\test', 'D:\\Local')).toBe(
      path.win32.join('D:\\Local', 'Microsoft', 'WindowsApps'),
    );
  });

  it('chooses durable per-user CLI data directories', () => {
    expect(defaultCliDataDirectory('darwin', '/Users/test', undefined, undefined)).toBe(
      path.join('/Users/test', 'Library', 'Application Support', 'Sitepull', 'cli'),
    );
    expect(defaultCliDataDirectory('linux', '/home/test', undefined, '/data')).toBe(
      path.join('/data', 'sitepull', 'cli'),
    );
    expect(defaultCliDataDirectory('win32', 'C:\\Users\\test', 'D:\\Local', undefined)).toBe(
      path.win32.join('D:\\Local', 'Sitepull', 'cli'),
    );
  });

  it('installs an idempotent POSIX symlink and recognizes PATH', async () => {
    const { source, bin } = await fixture();
    const first = await installGlobalCli({
      platform: 'darwin',
      source,
      binDirectory: bin,
      pathValue: bin,
    });
    const second = await installGlobalCli({
      platform: 'darwin',
      source,
      binDirectory: bin,
      pathValue: bin,
    });

    expect(first).toEqual({ destination: path.join(bin, 'sitepull'), pathConfigured: true });
    expect(second).toEqual(first);
  });

  it('refuses to replace an unrelated POSIX command', async () => {
    const { source, bin } = await fixture();
    await mkdir(bin);
    await writeFile(path.join(bin, 'sitepull'), 'unrelated');

    await expect(
      installGlobalCli({ platform: 'linux', source, binDirectory: bin }),
    ).rejects.toThrow(/Refusing to replace/u);
  });

  it('updates a POSIX link only when its previous target is installer-managed', async () => {
    const { root, source, bin } = await fixture();
    const nextSource = path.join(root, 'versions', '0.2.0', 'bin.js');
    await mkdir(path.dirname(nextSource), { recursive: true });
    await writeFile(nextSource, '#!/usr/bin/env node\n');
    await chmod(nextSource, 0o755);
    await mkdir(bin);
    await symlink(source, path.join(bin, 'sitepull'));

    await installGlobalCli({
      platform: 'darwin',
      source: nextSource,
      binDirectory: bin,
      managedSourceRoots: [root],
    });

    expect(path.resolve(bin, await readlink(path.join(bin, 'sitepull')))).toBe(nextSource);
  });

  it('installs an idempotent Windows command shim without requiring symlink privileges', async () => {
    const { source, bin } = await fixture();
    const first = await installGlobalCli({ platform: 'win32', source, binDirectory: bin });
    const second = await installGlobalCli({ platform: 'win32', source, binDirectory: bin });

    expect(first.destination).toBe(path.join(bin, 'sitepull.cmd'));
    expect(second.destination).toBe(first.destination);
    expect(await readFile(first.destination, 'utf8')).toBe(windowsCliLauncher(source));
  });

  it('escapes percent expansion in Windows launcher paths', () => {
    expect(windowsCliLauncher('C:\\Users\\100%\\sitepull\\bin.js')).toContain(
      '"C:\\Users\\100%%\\sitepull\\bin.js"',
    );
  });

  it('refuses to replace an unrelated Windows shim', async () => {
    const { source, bin } = await fixture();
    await mkdir(bin);
    await writeFile(path.join(bin, 'sitepull.cmd'), '@ECHO OFF\r\necho unrelated\r\n');

    await expect(
      installGlobalCli({ platform: 'win32', source, binDirectory: bin }),
    ).rejects.toThrow(/Refusing to replace/u);
  });

  it('updates a legacy Windows launcher only when its source is installer-managed', async () => {
    const { root, source, bin } = await fixture();
    const nextSource = path.join(root, 'versions', '0.2.0', 'bin.js');
    await mkdir(path.dirname(nextSource), { recursive: true });
    await writeFile(nextSource, '#!/usr/bin/env node\n');
    await chmod(nextSource, 0o755);
    await mkdir(bin);
    await writeFile(path.join(bin, 'sitepull.cmd'), `@ECHO OFF\r\nnode "${source}" %*\r\n`);

    await installGlobalCli({
      platform: 'win32',
      source: nextSource,
      binDirectory: bin,
      managedSourceRoots: [root],
    });

    expect(await readFile(path.join(bin, 'sitepull.cmd'), 'utf8')).toBe(
      windowsCliLauncher(nextSource),
    );
  });

  it('refuses to replace a Windows symlink', async () => {
    const { root, source, bin } = await fixture();
    await mkdir(bin);
    const unrelated = path.join(root, 'unrelated.cmd');
    await writeFile(unrelated, '@ECHO OFF\r\n');
    await symlink(unrelated, path.join(bin, 'sitepull.cmd'));

    await expect(
      installGlobalCli({ platform: 'win32', source, binDirectory: bin }),
    ).rejects.toThrow(/Refusing to replace/u);
  });
});
