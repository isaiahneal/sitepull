import { describe, expect, it } from 'vitest';

import {
  assertExactNativeReleaseAssets,
  expectedNativeReleaseAssets,
  publishedReleaseAssetName,
} from './release-assets.js';

describe('native release asset manifest', () => {
  it('names every platform, architecture, and Linux distribution exactly once', () => {
    const assets = expectedNativeReleaseAssets('0.4.0');

    expect(assets).toHaveLength(14);
    expect(new Set(assets).size).toBe(assets.length);
    expect(assets).toContain('Sitepull-0.4.0-arm64.dmg');
    expect(assets).toContain('Sitepull-0.4.0-x64.dmg');
    expect(assets).toContain('sitepull_0.4.0-1.ubuntu24.04_amd64.deb');
    expect(assets).toContain('sitepull_0.4.0-1.debian12_amd64.deb');
    expect(assets).toContain('sitepull_0.4.0-1.debian13_amd64.deb');
    expect(assets).toContain('sitepull-cli-0.4.0-1.fc44.x86_64.rpm');
    expect(assets).toContain('sitepull-cli-0.4.0-r0.apk');
    expect(assets).toContain('sitepull-alpine-v0.4.0.rsa.pub');
    expect(assets.some((asset) => asset.includes('~'))).toBe(false);
  });

  it('canonicalizes uploaded names before checksums and attestations are created', () => {
    expect(publishedReleaseAssetName('sitepull_0.4.0-1~debian12_amd64.deb')).toBe(
      'sitepull_0.4.0-1.debian12_amd64.deb',
    );
    expect(publishedReleaseAssetName('RELEASES')).toBe('Sitepull-windows-RELEASES');
    expect(publishedReleaseAssetName('Sitepull-0.4.0-x64.dmg')).toBe('Sitepull-0.4.0-x64.dmg');
    expect(publishedReleaseAssetName('sitepull-cli-0.4.0-1.fc44.x86_64.rpm')).toBe(
      'sitepull-cli-0.4.0-1.fc44.x86_64.rpm',
    );
    expect(publishedReleaseAssetName('sitepull-cli-0.4.0-r0.apk')).toBe(
      'sitepull-cli-0.4.0-r0.apk',
    );
    expect(publishedReleaseAssetName('sitepull-alpine-v0.4.0.rsa.pub')).toBe(
      'sitepull-alpine-v0.4.0.rsa.pub',
    );
    expect(publishedReleaseAssetName('ignored.yml')).toBeUndefined();
  });

  it('rejects missing, duplicate, and extra release artifacts', () => {
    const assets = expectedNativeReleaseAssets('0.4.0');

    expect(() => assertExactNativeReleaseAssets(assets.slice(1), '0.4.0')).toThrow(/missing:/u);
    expect(() => assertExactNativeReleaseAssets([...assets, assets[0]!], '0.4.0')).toThrow(
      /duplicate:/u,
    );
    expect(() => assertExactNativeReleaseAssets([...assets, 'unexpected.bin'], '0.4.0')).toThrow(
      /extra:/u,
    );
    expect(() => assertExactNativeReleaseAssets(assets, '0.4.0')).not.toThrow();
  });

  it('rejects non-release version input', () => {
    expect(() => expectedNativeReleaseAssets('../0.4.0')).toThrow(/Invalid Sitepull release/u);
  });
});
