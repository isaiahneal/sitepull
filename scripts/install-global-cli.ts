import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function defaultCliBinDirectory(
  platform: NodeJS.Platform,
  homeDirectory: string,
  localAppData: string | undefined,
): string {
  if (platform === 'win32') {
    const appData = localAppData ?? path.win32.join(homeDirectory, 'AppData', 'Local');
    return path.win32.join(appData, 'Microsoft', 'WindowsApps');
  }
  return path.join(homeDirectory, '.local', 'bin');
}

export function windowsCliLauncher(source: string): string {
  const escapedSource = source.replaceAll('%', '%%');
  return `@ECHO OFF\r\nnode "${escapedSource}" %*\r\n`;
}

async function installPosixLink(source: string, destination: string): Promise<void> {
  try {
    const existing = await lstat(destination);
    if (!existing.isSymbolicLink()) {
      throw new Error(`Refusing to replace the existing non-symlink command at ${destination}`);
    }
    const linkedPath = path.resolve(path.dirname(destination), await readlink(destination));
    if (linkedPath !== source) {
      throw new Error(`Refusing to replace the existing symlink at ${destination}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await symlink(source, destination, 'file');
  }
}

async function installWindowsLauncher(source: string, destination: string): Promise<void> {
  const launcher = windowsCliLauncher(source);
  try {
    const existing = await lstat(destination);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error(`Refusing to replace the existing command at ${destination}`);
    }
    if ((await readFile(destination, 'utf8')) !== launcher) {
      throw new Error(`Refusing to replace the existing command at ${destination}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeFile(destination, launcher, { encoding: 'utf8', flag: 'wx' });
  }
}

export async function installGlobalCli(
  options: {
    readonly platform?: NodeJS.Platform;
    readonly source?: string;
    readonly binDirectory?: string;
    readonly homeDirectory?: string;
    readonly localAppData?: string;
    readonly pathValue?: string;
  } = {},
): Promise<{ readonly destination: string; readonly pathConfigured: boolean }> {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const repositoryRoot = path.resolve(import.meta.dirname, '..');
  const source = path.resolve(
    options.source ?? path.join(repositoryRoot, 'apps', 'cli', 'dist', 'bin.js'),
  );
  const binDirectory = path.resolve(
    options.binDirectory ??
      process.env.SITEPULL_BIN_DIR ??
      defaultCliBinDirectory(
        platform,
        homeDirectory,
        options.localAppData ?? process.env.LOCALAPPDATA,
      ),
  );
  const destination = path.join(binDirectory, platform === 'win32' ? 'sitepull.cmd' : 'sitepull');

  await access(source, platform === 'win32' ? constants.R_OK : constants.R_OK | constants.X_OK);
  await mkdir(binDirectory, { recursive: true });
  if (platform === 'win32') await installWindowsLauncher(source, destination);
  else await installPosixLink(source, destination);

  const canonicalBinDirectory = path.resolve(binDirectory);
  const normalizePath = (value: string) =>
    platform === 'win32' ? path.win32.resolve(value).toLowerCase() : path.resolve(value);
  const pathConfigured = (options.pathValue ?? process.env.PATH ?? '')
    .split(platform === 'win32' ? path.win32.delimiter : path.posix.delimiter)
    .some((entry) => entry !== '' && normalizePath(entry) === normalizePath(canonicalBinDirectory));

  return { destination, pathConfigured };
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  const result = await installGlobalCli();
  console.log(`Installed sitepull at ${result.destination}`);
  if (!result.pathConfigured) {
    console.log(`Add ${path.dirname(result.destination)} to PATH before opening a new terminal.`);
  }
}
