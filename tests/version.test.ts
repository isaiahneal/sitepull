import { readFileSync } from 'node:fs';

import { SITEPULL_VERSION } from '@sitepull/contracts';
import { describe, expect, it } from 'vitest';

const PACKAGE_MANIFESTS = [
  '../package.json',
  '../apps/cli/package.json',
  '../apps/desktop/package.json',
  '../packages/contracts/package.json',
  '../packages/core/package.json',
] as const;

describe('release version', () => {
  it('keeps package metadata aligned with the shared runtime version', () => {
    expect(SITEPULL_VERSION).toBe('0.2.0');

    for (const manifestPath of PACKAGE_MANIFESTS) {
      const manifest = JSON.parse(readFileSync(new URL(manifestPath, import.meta.url), 'utf8')) as {
        name: string;
        version: string;
      };
      expect(manifest.version, manifest.name).toBe(SITEPULL_VERSION);
    }
  });
});
