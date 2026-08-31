import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_HOSTS = {
  'ubuntu24.04': { id: 'ubuntu', version: '24.04' },
  debian12: { id: 'debian', version: '12' },
  debian13: { id: 'debian', version: '13' },
} as const;

export type LinuxDistributionTarget = keyof typeof EXPECTED_HOSTS;

export function parseOsRelease(contents: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) continue;
    const first = rawValue.at(0);
    const last = rawValue.at(-1);
    const value =
      rawValue.length >= 2 && (first === '"' || first === "'") && last === first
        ? rawValue.slice(1, -1)
        : rawValue;
    values[key] = value.replaceAll('\\"', '"').replaceAll('\\\\', '\\');
  }
  return values;
}

export function assertLinuxBuildHost(
  target: string,
  platform: NodeJS.Platform = process.platform,
  osReleaseContents = platform === 'linux' ? readFileSync('/etc/os-release', 'utf8') : '',
): asserts target is LinuxDistributionTarget {
  if (!(target in EXPECTED_HOSTS)) {
    throw new Error(
      `Unsupported Linux distribution target ${JSON.stringify(target)}. Expected: ${Object.keys(EXPECTED_HOSTS).join(', ')}.`,
    );
  }
  if (platform !== 'linux') {
    throw new Error(`Linux target ${target} must be built on its matching native Linux host.`);
  }

  const expected = EXPECTED_HOSTS[target as LinuxDistributionTarget];
  const release = parseOsRelease(osReleaseContents);
  if (release.ID !== expected.id || release.VERSION_ID !== expected.version) {
    throw new Error(
      `Linux target ${target} requires ${expected.id} ${expected.version}; received ${release.ID ?? 'unknown'} ${release.VERSION_ID ?? 'unknown'}.`,
    );
  }
}

function main(): void {
  const target = process.argv[2];
  if (target === undefined || process.argv.length !== 3) {
    throw new Error('Usage: verify-linux-target.ts <ubuntu24.04|debian12|debian13>');
  }
  assertLinuxBuildHost(target);
  console.log(`Verified native Linux build host for ${target}.`);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  main();
}
