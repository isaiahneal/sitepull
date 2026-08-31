import { describe, expect, it } from 'vitest';

import {
  assertExactReleaseAssets,
  expectedReleaseAssets,
  publishedReleaseAssetName,
} from './release-assets.js';

describe('release asset manifest', () => {
  it('names every package and installer exactly once', () => {
    const assets = expectedReleaseAssets('0.4.1');

    expect(assets).toHaveLength(16);
    expect(new Set(assets).size).toBe(assets.length);
    expect(assets).toContain('Sitepull-0.4.1-arm64.dmg');
    expect(assets).toContain('Sitepull-0.4.1-x64.dmg');
    expect(assets).toContain('sitepull_0.4.1-1.ubuntu24.04_amd64.deb');
    expect(assets).toContain('sitepull_0.4.1-1.debian12_amd64.deb');
    expect(assets).toContain('sitepull_0.4.1-1.debian13_amd64.deb');
    expect(assets).toContain('sitepull-cli-0.4.1-1.fc44.x86_64.rpm');
    expect(assets).toContain('sitepull-cli-0.4.1-r0.apk');
    expect(assets).toContain('sitepull-alpine-v0.4.1.rsa.pub');
    expect(assets).toContain('sitepull-install.sh');
    expect(assets).toContain('sitepull-install.ps1');
    expect(assets.some((asset) => asset.includes('~'))).toBe(false);
  });

  it('canonicalizes uploaded names before checksums and attestations are created', () => {
    expect(publishedReleaseAssetName('sitepull_0.4.1-1~debian12_amd64.deb')).toBe(
      'sitepull_0.4.1-1.debian12_amd64.deb',
    );
    expect(publishedReleaseAssetName('RELEASES')).toBe('Sitepull-windows-RELEASES');
    expect(publishedReleaseAssetName('Sitepull-0.4.1-x64.dmg')).toBe('Sitepull-0.4.1-x64.dmg');
    expect(publishedReleaseAssetName('sitepull-cli-0.4.1-1.fc44.x86_64.rpm')).toBe(
      'sitepull-cli-0.4.1-1.fc44.x86_64.rpm',
    );
    expect(publishedReleaseAssetName('sitepull-cli-0.4.1-r0.apk')).toBe(
      'sitepull-cli-0.4.1-r0.apk',
    );
    expect(publishedReleaseAssetName('sitepull-alpine-v0.4.1.rsa.pub')).toBe(
      'sitepull-alpine-v0.4.1.rsa.pub',
    );
    expect(publishedReleaseAssetName('ignored.yml')).toBeUndefined();
  });

  it('rejects missing, duplicate, and extra release artifacts', () => {
    const assets = expectedReleaseAssets('0.4.1');

    expect(() => assertExactReleaseAssets(assets.slice(1), '0.4.1')).toThrow(/missing:/u);
    expect(() => assertExactReleaseAssets([...assets, assets[0]!], '0.4.1')).toThrow(/duplicate:/u);
    expect(() => assertExactReleaseAssets([...assets, 'unexpected.bin'], '0.4.1')).toThrow(
      /extra:/u,
    );
    expect(() => assertExactReleaseAssets(assets, '0.4.1')).not.toThrow();
  });

  it('rejects non-release version input', () => {
    expect(() => expectedReleaseAssets('../0.4.1')).toThrow(/Invalid Sitepull release/u);
  });
});
