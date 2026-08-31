import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function expectedNativeReleaseAssets(version: string): string[] {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`Invalid Sitepull release version: ${JSON.stringify(version)}`);
  }
  return [
    `Sitepull-${version}-arm64.dmg`,
    `Sitepull-${version}-x64.dmg`,
    `Sitepull-darwin-arm64-${version}.zip`,
    `Sitepull-darwin-x64-${version}.zip`,
    `sitepull_${version}-1.ubuntu24.04_amd64.deb`,
    `sitepull_${version}-1.debian12_amd64.deb`,
    `sitepull_${version}-1.debian13_amd64.deb`,
    'SitepullSetup.exe',
    `sitepull-${version}-full.nupkg`,
    'Sitepull-windows-RELEASES',
    `Sitepull-win32-x64-${version}.zip`,
  ];
}

export function publishedReleaseAssetName(sourceName: string): string | undefined {
  if (sourceName === 'RELEASES') return 'Sitepull-windows-RELEASES';
  if (sourceName.endsWith('.deb')) {
    // GitHub normalizes `~` to `.` in uploaded asset names. Make that
    // transformation before hashing and attesting so the manifest names the
    // files users actually download. The DEB's internal version keeps `~`.
    return sourceName.replaceAll('~', '.');
  }
  if (
    sourceName.endsWith('.dmg') ||
    sourceName.endsWith('.zip') ||
    sourceName.endsWith('Setup.exe') ||
    sourceName.endsWith('.nupkg')
  ) {
    return sourceName;
  }
  return undefined;
}

export function assertExactNativeReleaseAssets(
  actualNames: readonly string[],
  version: string,
): void {
  const expected = expectedNativeReleaseAssets(version);
  const duplicates = actualNames.filter((name, index) => actualNames.indexOf(name) !== index);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actualNames);
  const missing = expected.filter((name) => !actualSet.has(name));
  const extra = [...actualSet].filter((name) => !expectedSet.has(name));

  if (duplicates.length > 0 || missing.length > 0 || extra.length > 0) {
    const details = [
      duplicates.length === 0 ? '' : `duplicate: ${[...new Set(duplicates)].sort().join(', ')}`,
      missing.length === 0 ? '' : `missing: ${missing.sort().join(', ')}`,
      extra.length === 0 ? '' : `extra: ${extra.sort().join(', ')}`,
    ].filter(Boolean);
    throw new Error(
      `Native release assets do not match the exact platform manifest (${details.join('; ')})`,
    );
  }
}

async function main(): Promise<void> {
  const [command, version, directory] = process.argv.slice(2);
  if (command === 'published-name' && version !== undefined && directory === undefined) {
    process.stdout.write(publishedReleaseAssetName(version) ?? '');
    return;
  }
  if (command === 'print' && version !== undefined && directory === undefined) {
    process.stdout.write(`${expectedNativeReleaseAssets(version).join('\n')}\n`);
    return;
  }
  if (command === 'verify' && version !== undefined && directory !== undefined) {
    const entries = await readdir(path.resolve(directory), { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    assertExactNativeReleaseAssets(files, version);
    console.log(`Verified ${files.length} exact native release assets.`);
    return;
  }
  throw new Error(
    'Usage: release-assets.ts published-name <source-name> | print <version> | verify <version> <directory>',
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  await main();
}
