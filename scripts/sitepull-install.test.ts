import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const installerPath = fileURLToPath(new URL('./sitepull-install.sh', import.meta.url));
let fixtureDirectory = '';

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'sitepull-installer-test-'));
});

afterAll(async () => {
  if (fixtureDirectory !== '') {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

function runInstaller(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>> = {},
) {
  return spawnSync('/bin/sh', [installerPath, ...arguments_], {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

async function linuxRelease(id: string, version: string): Promise<string> {
  const releasePath = path.join(fixtureDirectory, `${id}-${version}.os-release`);
  await writeFile(releasePath, `ID=${id}\nVERSION_ID="${version}"\n`, 'utf8');
  return releasePath;
}

describe('POSIX GitHub release installer', () => {
  it.each([
    ['arm64', '15.0', 'Sitepull-0.5.0-arm64.dmg'],
    ['x86_64', '26.1', 'Sitepull-0.5.0-x64.dmg'],
  ])('selects the macOS %s package', (architecture, macosVersion, expectedAsset) => {
    const result = runInstaller(['--dry-run', '--version', 'v0.5.0'], {
      HOME: '/Users/sitepull-test',
      SITEPULL_INSTALLER_TEST_ARCH: architecture,
      SITEPULL_INSTALLER_TEST_MACOS_VERSION: macosVersion,
      SITEPULL_INSTALLER_TEST_MODE: '1',
      SITEPULL_INSTALLER_TEST_OS: 'Darwin',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Asset: ${expectedAsset}`);
    expect(result.stdout).toContain('mount DMG');
  });

  it.each([
    ['ubuntu', '24.04', 'sitepull_0.5.0-1.ubuntu24.04_amd64.deb', 'apt-get'],
    ['debian', '12', 'sitepull_0.5.0-1.debian12_amd64.deb', 'apt-get'],
    ['debian', '13', 'sitepull_0.5.0-1.debian13_amd64.deb', 'apt-get'],
    ['fedora', '44', 'sitepull-cli-0.5.0-1.fc44.x86_64.rpm', 'dnf'],
    ['alpine', '3.24.2', 'sitepull-cli-0.5.0-r0.apk', 'apk add'],
  ])('selects the %s %s package', async (distribution, version, expectedAsset, expectedMethod) => {
    const result = runInstaller(['--dry-run', '--version=0.5.0'], {
      SITEPULL_INSTALLER_TEST_ARCH: 'x86_64',
      SITEPULL_INSTALLER_TEST_MODE: '1',
      SITEPULL_INSTALLER_TEST_OS: 'Linux',
      SITEPULL_INSTALLER_TEST_OS_RELEASE: await linuxRelease(distribution, version),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Asset: ${expectedAsset}`);
    expect(result.stdout).toContain(expectedMethod);
    if (distribution === 'alpine') {
      expect(result.stdout).toContain('Signing key: sitepull-alpine-v0.5.0.rsa.pub');
    }
  });

  it('keeps an unpinned dry run offline', () => {
    const result = runInstaller(['--dry-run'], {
      HOME: '/Users/sitepull-test',
      SITEPULL_INSTALLER_TEST_ARCH: 'arm64',
      SITEPULL_INSTALLER_TEST_MACOS_VERSION: '15.4',
      SITEPULL_INSTALLER_TEST_MODE: '1',
      SITEPULL_INSTALLER_TEST_OS: 'Darwin',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Version: latest (resolution deferred');
    expect(result.stdout).toContain('Sitepull-<resolved-version>-arm64.dmg');
  });

  it.each([
    ['Darwin', 'arm64', '14.7', '', 'macOS 15 or newer is required'],
    ['Linux', 'aarch64', '', 'ubuntu:24.04', 'require x86_64'],
    ['Linux', 'x86_64', '', 'ubuntu:22.04', 'unsupported Linux distribution'],
  ])(
    'rejects an unsupported host before download',
    async (detectedOs, architecture, macosVersion, linuxIdentity, expectedError) => {
      const environment: Record<string, string> = {
        HOME: '/Users/sitepull-test',
        SITEPULL_INSTALLER_TEST_ARCH: architecture,
        SITEPULL_INSTALLER_TEST_MODE: '1',
        SITEPULL_INSTALLER_TEST_OS: detectedOs,
      };
      if (macosVersion !== '') {
        environment.SITEPULL_INSTALLER_TEST_MACOS_VERSION = macosVersion;
      }
      if (linuxIdentity !== '') {
        const [distribution, version] = linuxIdentity.split(':') as [string, string];
        environment.SITEPULL_INSTALLER_TEST_OS_RELEASE = await linuxRelease(distribution, version);
      }

      const result = runInstaller(['--dry-run', '--version', '0.5.0'], environment);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(expectedError);
    },
  );

  it('rejects invalid versions without network access', () => {
    const result = runInstaller(['--dry-run', '--version', '../0.5.0']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('release versions must have the form');
  });

  it('rejects a mismatched package checksum before invoking an installer', async () => {
    let selectedAsset: string | undefined;
    if (process.platform === 'darwin') {
      selectedAsset = `Sitepull-0.5.0-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg`;
    } else if (process.platform === 'linux') {
      const osRelease = await readFile('/etc/os-release', 'utf8');
      if (/^ID=ubuntu$/mu.test(osRelease) && /^VERSION_ID="?24\.04"?$/mu.test(osRelease)) {
        selectedAsset = 'sitepull_0.5.0-1.ubuntu24.04_amd64.deb';
      }
    }
    if (selectedAsset === undefined) return;

    const mockBin = path.join(fixtureDirectory, 'checksum-mock-bin');
    const installerMarker = path.join(fixtureDirectory, 'installer-was-invoked');
    await mkdir(mockBin, { recursive: true });

    const fakeCurl = path.join(mockBin, 'curl');
    await writeFile(
      fakeCurl,
      `#!/bin/sh
set -eu
destination=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) destination=$2; shift 2 ;;
    --) shift; url=$1; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  */releases/latest) printf '%s\n' '{' '  "tag_name": "v0.5.0",' '  "draft": false' '}' >"$destination" ;;
  */SHA256SUMS.txt) printf '%064d  %s\\n' 0 "$SITEPULL_FAKE_ASSET" >"$destination" ;;
  *) printf '%s' 'tampered package bytes' >"$destination" ;;
esac
`,
      { encoding: 'utf8', mode: 0o755 },
    );
    await chmod(fakeCurl, 0o755);

    for (const command of ['apt-get', 'hdiutil']) {
      const mockCommand = path.join(mockBin, command);
      await writeFile(
        mockCommand,
        `#!/bin/sh\nprintf '%s\\n' invoked >"$SITEPULL_INSTALLER_MARKER"\nexit 99\n`,
        { encoding: 'utf8', mode: 0o755 },
      );
      await chmod(mockCommand, 0o755);
    }

    const result = runInstaller([], {
      PATH: `${mockBin}${path.delimiter}${process.env.PATH ?? ''}`,
      SITEPULL_FAKE_ASSET: selectedAsset,
      SITEPULL_INSTALLER_MARKER: installerMarker,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`SHA-256 mismatch for ${selectedAsset}`);
    await expect(readFile(installerMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
