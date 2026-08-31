import { execFile } from 'node:child_process';
import { createHash, randomUUID, type Hash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MANAGED_WINDOWS_LAUNCHER_MARKER = '@REM Managed by the Sitepull installer';
const VOLATILE_DEPLOYMENT_PATHS = new Set([
  'pnpm-lock.yaml',
  path.join('node_modules', '.modules.yaml'),
  path.join('node_modules', '.pnpm', 'lock.yaml'),
  path.join('node_modules', '.pnpm-workspace-state-v1.json'),
]);

type AtomicRename = (source: string, destination: string) => Promise<void>;

export async function replaceCommandAtomically(
  destination: string,
  prepareTemporaryCommand: (temporaryPath: string) => Promise<void>,
  atomicRename: AtomicRename = rename,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.sitepull-${process.pid}-${randomUUID()}`,
  );
  try {
    await prepareTemporaryCommand(temporaryPath);
    await atomicRename(temporaryPath, destination);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function createCommandExclusively(
  destination: string,
  prepareTemporaryCommand: (temporaryPath: string) => Promise<void>,
  createHardlink: AtomicRename = link,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.sitepull-${process.pid}-${randomUUID()}`,
  );
  try {
    await prepareTemporaryCommand(temporaryPath);
    await createHardlink(temporaryPath, destination);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function appendDeploymentFingerprint(
  root: string,
  relativePath: string,
  hash: Hash,
): Promise<void> {
  if (VOLATILE_DEPLOYMENT_PATHS.has(relativePath)) return;
  const target = path.join(root, relativePath);
  const metadata = await lstat(target);
  if (metadata.isDirectory()) {
    hash.update(`directory\0${relativePath}\0${metadata.mode & 0o777}\0`);
    const entries = await readdir(target, { withFileTypes: true });
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      await appendDeploymentFingerprint(root, path.join(relativePath, entry.name), hash);
    }
    return;
  }
  if (metadata.isSymbolicLink()) {
    hash.update(`symlink\0${relativePath}\0${await readlink(target)}\0`);
    return;
  }
  if (!metadata.isFile()) {
    throw new Error(`The Sitepull deployment contains an unsupported entry at ${relativePath}.`);
  }
  hash.update(`file\0${relativePath}\0${metadata.mode & 0o777}\0`);
  hash.update(await readFile(target));
  hash.update('\0');
}

async function deploymentFingerprint(root: string): Promise<string> {
  const hash = createHash('sha256');
  await appendDeploymentFingerprint(root, '', hash);
  return hash.digest('hex');
}

async function assertNoHardlinkedRegularFiles(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await assertNoHardlinkedRegularFiles(target);
      continue;
    }
    if (!entry.isFile()) continue;
    if ((await lstat(target)).nlink > 1) {
      throw new Error(`The Sitepull deployment contains a mutable hardlink at ${target}.`);
    }
  }
}

async function assertIndependentRegularFiles(
  sourceDirectory: string,
  copiedDirectory: string,
): Promise<void> {
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    const source = path.join(sourceDirectory, entry.name);
    const copied = path.join(copiedDirectory, entry.name);
    if (entry.isDirectory()) {
      await assertIndependentRegularFiles(source, copied);
      continue;
    }
    if (!entry.isFile()) continue;

    const [sourceMetadata, copiedMetadata] = await Promise.all([lstat(source), lstat(copied)]);
    if (!copiedMetadata.isFile()) {
      throw new Error(`The isolated Sitepull deployment is missing ${entry.name}.`);
    }
    if (copiedMetadata.nlink > 1) {
      throw new Error(`The isolated Sitepull deployment retains a hardlink for ${entry.name}.`);
    }
    if (
      process.platform !== 'win32' &&
      sourceMetadata.dev === copiedMetadata.dev &&
      sourceMetadata.ino === copiedMetadata.ino
    ) {
      throw new Error(`The isolated Sitepull deployment still shares storage for ${entry.name}.`);
    }
  }
}

export async function copyDeploymentIsolated(
  sourceDirectory: string,
  copiedDirectory: string,
): Promise<void> {
  await cp(sourceDirectory, copiedDirectory, {
    errorOnExist: true,
    force: false,
    recursive: true,
    verbatimSymlinks: true,
  });
  await assertIndependentRegularFiles(sourceDirectory, copiedDirectory);
}

export async function installImmutableDeployment(
  candidateDirectory: string,
  deploymentDirectory: string,
): Promise<boolean> {
  try {
    const existing = await lstat(deploymentDirectory);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(`Refusing to replace the existing path at ${deploymentDirectory}.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await rename(candidateDirectory, deploymentDirectory);
    return true;
  }

  await assertNoHardlinkedRegularFiles(deploymentDirectory);
  const [existingFingerprint, candidateFingerprint] = await Promise.all([
    deploymentFingerprint(deploymentDirectory),
    deploymentFingerprint(candidateDirectory),
  ]);
  if (existingFingerprint !== candidateFingerprint) {
    throw new Error(
      `Sitepull CLI ${path.basename(deploymentDirectory)} is already installed with different contents. Bump the package version before replacing an immutable deployment.`,
    );
  }
  return false;
}

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

export function defaultCliDataDirectory(
  platform: NodeJS.Platform,
  homeDirectory: string,
  localAppData: string | undefined,
  xdgDataHome: string | undefined,
): string {
  if (platform === 'win32') {
    const appData = localAppData ?? path.win32.join(homeDirectory, 'AppData', 'Local');
    return path.win32.join(appData, 'Sitepull', 'cli');
  }
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', 'Sitepull', 'cli');
  }
  return path.join(xdgDataHome ?? path.join(homeDirectory, '.local', 'share'), 'sitepull', 'cli');
}

export function windowsCliLauncher(source: string): string {
  const escapedSource = source.replaceAll('%', '%%');
  return `@ECHO OFF\r\n${MANAGED_WINDOWS_LAUNCHER_MARKER}\r\nnode "${escapedSource}" %*\r\n`;
}

function isInsideOrEqual(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

async function installPosixLink(
  source: string,
  destination: string,
  managedSourceRoots: readonly string[],
): Promise<void> {
  try {
    const existing = await lstat(destination);
    if (!existing.isSymbolicLink()) {
      throw new Error(`Refusing to replace the existing non-symlink command at ${destination}`);
    }
    const linkedPath = path.resolve(path.dirname(destination), await readlink(destination));
    if (linkedPath !== source) {
      if (!managedSourceRoots.some((root) => isInsideOrEqual(root, linkedPath))) {
        throw new Error(`Refusing to replace the existing symlink at ${destination}`);
      }
      await replaceCommandAtomically(destination, (temporaryPath) =>
        symlink(source, temporaryPath, 'file'),
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await symlink(source, destination, 'file');
  }
}

async function installWindowsLauncher(
  source: string,
  destination: string,
  managedSourceRoots: readonly string[],
): Promise<void> {
  const launcher = windowsCliLauncher(source);
  try {
    const existing = await lstat(destination);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error(`Refusing to replace the existing command at ${destination}`);
    }
    const existingLauncher = await readFile(destination, 'utf8');
    if (existingLauncher !== launcher) {
      const sourceMatch =
        /^@ECHO OFF\r?\n(?:@REM Managed by the Sitepull installer\r?\n)?node "([^"]+)" %\*\r?\n$/u.exec(
          existingLauncher,
        );
      const previousSource = sourceMatch?.[1]?.replaceAll('%%', '%');
      if (
        previousSource === undefined ||
        !managedSourceRoots.some((root) => isInsideOrEqual(root, path.resolve(previousSource)))
      ) {
        throw new Error(`Refusing to replace the existing command at ${destination}`);
      }
      await replaceCommandAtomically(destination, (temporaryPath) =>
        writeFile(temporaryPath, launcher, { encoding: 'utf8', flag: 'wx' }),
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await createCommandExclusively(destination, (temporaryPath) =>
      writeFile(temporaryPath, launcher, { encoding: 'utf8', flag: 'wx' }),
    );
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
    readonly managedSourceRoots?: readonly string[];
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
  const managedSourceRoots = (options.managedSourceRoots ?? []).map((root) => path.resolve(root));

  await access(source, platform === 'win32' ? constants.R_OK : constants.R_OK | constants.X_OK);
  await mkdir(binDirectory, { recursive: true });
  if (platform === 'win32') await installWindowsLauncher(source, destination, managedSourceRoots);
  else await installPosixLink(source, destination, managedSourceRoots);

  const canonicalBinDirectory = path.resolve(binDirectory);
  const normalizePath = (value: string) =>
    platform === 'win32' ? path.win32.resolve(value).toLowerCase() : path.resolve(value);
  const pathConfigured = (options.pathValue ?? process.env.PATH ?? '')
    .split(platform === 'win32' ? path.win32.delimiter : path.posix.delimiter)
    .some((entry) => entry !== '' && normalizePath(entry) === normalizePath(canonicalBinDirectory));

  return { destination, pathConfigured };
}

function pnpmInvocation(): { command: string; prefixArgs: string[] } {
  const npmExecPath = process.env.npm_execpath;
  if (
    npmExecPath !== undefined &&
    path.isAbsolute(npmExecPath) &&
    /\.(?:c|m)?js$/iu.test(npmExecPath)
  ) {
    return { command: process.execPath, prefixArgs: [npmExecPath] };
  }
  if (process.platform === 'win32') {
    const pnpmHome = process.env.PNPM_HOME;
    if (pnpmHome === undefined || !path.win32.isAbsolute(pnpmHome)) {
      throw new Error('The Sitepull CLI installer could not locate pnpm on Windows.');
    }
    return { command: path.win32.join(pnpmHome, 'pnpm.exe'), prefixArgs: [] };
  }
  return { command: 'pnpm', prefixArgs: [] };
}

export async function deployAndInstallGlobalCli(
  options: {
    readonly homeDirectory?: string;
    readonly localAppData?: string;
    readonly xdgDataHome?: string;
    readonly pathValue?: string;
  } = {},
): Promise<{
  readonly destination: string;
  readonly deploymentDirectory: string;
  readonly pathConfigured: boolean;
}> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const repositoryRoot = path.resolve(import.meta.dirname, '..');
  const cliPackage = JSON.parse(
    await readFile(path.join(repositoryRoot, 'apps', 'cli', 'package.json'), 'utf8'),
  ) as { name?: unknown; version?: unknown };
  if (cliPackage.name !== '@sitepull/cli' || typeof cliPackage.version !== 'string') {
    throw new Error('The built Sitepull CLI package metadata is invalid.');
  }

  const dataDirectory = defaultCliDataDirectory(
    process.platform,
    homeDirectory,
    options.localAppData ?? process.env.LOCALAPPDATA,
    options.xdgDataHome ?? process.env.XDG_DATA_HOME,
  );
  const versionsDirectory = path.join(dataDirectory, 'versions');
  const deploymentDirectory = path.join(versionsDirectory, cliPackage.version);
  await mkdir(versionsDirectory, { recursive: true });
  const stagingDirectory = await mkdtemp(path.join(versionsDirectory, `.${cliPackage.version}-`));
  const isolatedStagingDirectory = `${stagingDirectory}-isolated`;

  try {
    const pnpm = pnpmInvocation();
    await execFileAsync(
      pnpm.command,
      [
        ...pnpm.prefixArgs,
        '--config.inject-workspace-packages=true',
        '--config.package-import-method=copy',
        '--filter',
        '@sitepull/cli',
        'deploy',
        '--prod',
        stagingDirectory,
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          CI: 'true',
          pnpm_config_verify_deps_before_run: 'false',
        },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    await copyDeploymentIsolated(stagingDirectory, isolatedStagingDirectory);
    await access(
      path.join(isolatedStagingDirectory, 'dist', 'bin.js'),
      constants.R_OK | constants.X_OK,
    );
    const deployedPackage = JSON.parse(
      await readFile(path.join(isolatedStagingDirectory, 'package.json'), 'utf8'),
    ) as { name?: unknown; version?: unknown };
    if (
      deployedPackage.name !== '@sitepull/cli' ||
      deployedPackage.version !== cliPackage.version
    ) {
      throw new Error('The deployed Sitepull CLI package does not match the requested version.');
    }

    const deploymentCreated = await installImmutableDeployment(
      isolatedStagingDirectory,
      deploymentDirectory,
    );

    try {
      const installed = await installGlobalCli({
        homeDirectory,
        ...(options.localAppData === undefined ? {} : { localAppData: options.localAppData }),
        ...(options.pathValue === undefined ? {} : { pathValue: options.pathValue }),
        source: path.join(deploymentDirectory, 'dist', 'bin.js'),
        managedSourceRoots: [versionsDirectory, path.join(repositoryRoot, 'apps', 'cli', 'dist')],
      });
      return { ...installed, deploymentDirectory };
    } catch (error) {
      if (deploymentCreated) await rm(deploymentDirectory, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await Promise.all(
      [stagingDirectory, isolatedStagingDirectory].map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  const result = await deployAndInstallGlobalCli();
  console.log(`Deployed Sitepull CLI to ${result.deploymentDirectory}`);
  console.log(`Installed sitepull at ${result.destination}`);
  if (!result.pathConfigured) {
    console.log(`Add ${path.dirname(result.destination)} to PATH before opening a new terminal.`);
  }
}
