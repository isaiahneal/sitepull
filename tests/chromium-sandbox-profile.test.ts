import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const PROFILE_URL = new URL('../packaging/chromium/seccomp_profile.json', import.meta.url);
const PLAYWRIGHT_1_62_1_PROFILE_SHA256 =
  'cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849';

describe('Chromium container sandbox profile', () => {
  it('stays byte-for-byte pinned to Playwright 1.62.1', () => {
    const profile = readFileSync(PROFILE_URL);
    expect(createHash('sha256').update(profile).digest('hex')).toBe(
      PLAYWRIGHT_1_62_1_PROFILE_SHA256,
    );
  });

  it('permits Chromium namespace creation without making seccomp unconfined', () => {
    const profile = JSON.parse(readFileSync(PROFILE_URL, 'utf8')) as {
      defaultAction: string;
      syscalls: Array<{ action: string; names: string[] }>;
    };

    expect(profile.defaultAction).toBe('SCMP_ACT_ERRNO');
    expect(profile.syscalls[0]).toMatchObject({
      action: 'SCMP_ACT_ALLOW',
      names: ['clone', 'setns', 'unshare'],
    });
  });
});
