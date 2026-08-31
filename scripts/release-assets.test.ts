import { describe, expect, it } from 'vitest';

import { assertExactNativeReleaseAssets, expectedNativeReleaseAssets } from './release-assets.js';

describe('native release asset manifest', () => {
  it('names every platform, architecture, and Linux distribution exactly once', () => {
    const assets = expectedNativeReleaseAssets('0.3.0');

    expect(assets).toHaveLength(11);
    expect(new Set(assets).size).toBe(assets.length);
    expect(assets).toContain('Sitepull-0.3.0-arm64.dmg');
    expect(assets).toContain('Sitepull-0.3.0-x64.dmg');
    expect(assets).toContain('sitepull_0.3.0-1~ubuntu24.04_amd64.deb');
    expect(assets).toContain('sitepull_0.3.0-1~debian12_amd64.deb');
    expect(assets).toContain('sitepull_0.3.0-1~debian13_amd64.deb');
  });

  it('rejects missing, duplicate, and extra release artifacts', () => {
    const assets = expectedNativeReleaseAssets('0.3.0');

    expect(() => assertExactNativeReleaseAssets(assets.slice(1), '0.3.0')).toThrow(/missing:/u);
    expect(() => assertExactNativeReleaseAssets([...assets, assets[0]!], '0.3.0')).toThrow(
      /duplicate:/u,
    );
    expect(() => assertExactNativeReleaseAssets([...assets, 'unexpected.bin'], '0.3.0')).toThrow(
      /extra:/u,
    );
    expect(() => assertExactNativeReleaseAssets(assets, '0.3.0')).not.toThrow();
  });

  it('rejects non-release version input', () => {
    expect(() => expectedNativeReleaseAssets('../0.3.0')).toThrow(/Invalid Sitepull release/u);
  });
});
