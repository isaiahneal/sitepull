import { describe, expect, it } from 'vitest';

import {
  assertExactNativeReleaseAssets,
  expectedNativeReleaseAssets,
  publishedReleaseAssetName,
} from './release-assets.js';

describe('native release asset manifest', () => {
  it('names every platform, architecture, and Linux distribution exactly once', () => {
    const assets = expectedNativeReleaseAssets('0.3.1');

    expect(assets).toHaveLength(11);
    expect(new Set(assets).size).toBe(assets.length);
    expect(assets).toContain('Sitepull-0.3.1-arm64.dmg');
    expect(assets).toContain('Sitepull-0.3.1-x64.dmg');
    expect(assets).toContain('sitepull_0.3.1-1.ubuntu24.04_amd64.deb');
    expect(assets).toContain('sitepull_0.3.1-1.debian12_amd64.deb');
    expect(assets).toContain('sitepull_0.3.1-1.debian13_amd64.deb');
    expect(assets.some((asset) => asset.includes('~'))).toBe(false);
  });

  it('canonicalizes uploaded names before checksums and attestations are created', () => {
    expect(publishedReleaseAssetName('sitepull_0.3.1-1~debian12_amd64.deb')).toBe(
      'sitepull_0.3.1-1.debian12_amd64.deb',
    );
    expect(publishedReleaseAssetName('RELEASES')).toBe('Sitepull-windows-RELEASES');
    expect(publishedReleaseAssetName('Sitepull-0.3.1-x64.dmg')).toBe('Sitepull-0.3.1-x64.dmg');
    expect(publishedReleaseAssetName('ignored.yml')).toBeUndefined();
  });

  it('rejects missing, duplicate, and extra release artifacts', () => {
    const assets = expectedNativeReleaseAssets('0.3.1');

    expect(() => assertExactNativeReleaseAssets(assets.slice(1), '0.3.1')).toThrow(/missing:/u);
    expect(() => assertExactNativeReleaseAssets([...assets, assets[0]!], '0.3.1')).toThrow(
      /duplicate:/u,
    );
    expect(() => assertExactNativeReleaseAssets([...assets, 'unexpected.bin'], '0.3.1')).toThrow(
      /extra:/u,
    );
    expect(() => assertExactNativeReleaseAssets(assets, '0.3.1')).not.toThrow();
  });

  it('rejects non-release version input', () => {
    expect(() => expectedNativeReleaseAssets('../0.3.1')).toThrow(/Invalid Sitepull release/u);
  });
});
