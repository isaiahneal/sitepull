import { describe, expect, it } from 'vitest';

import { assertLinuxBuildHost, parseOsRelease } from '../../scripts/verify-linux-target.js';

describe('Linux distribution build host guard', () => {
  it('parses quoted and unquoted os-release fields without executing them', () => {
    expect(parseOsRelease('ID=debian\nVERSION_ID="12"\nNAME="Debian GNU/Linux"\n')).toEqual({
      ID: 'debian',
      VERSION_ID: '12',
      NAME: 'Debian GNU/Linux',
    });
  });

  it('accepts only the exact native distribution and version', () => {
    expect(() =>
      assertLinuxBuildHost('ubuntu24.04', 'linux', 'ID=ubuntu\nVERSION_ID="24.04"\n'),
    ).not.toThrow();
    expect(() =>
      assertLinuxBuildHost('debian12', 'linux', 'ID=debian\nVERSION_ID="12"\n'),
    ).not.toThrow();
    expect(() =>
      assertLinuxBuildHost('debian13', 'linux', 'ID=debian\nVERSION_ID="13"\n'),
    ).not.toThrow();
  });

  it('rejects cross-distribution, cross-version, cross-platform, and unknown builds', () => {
    expect(() =>
      assertLinuxBuildHost('ubuntu24.04', 'linux', 'ID=debian\nVERSION_ID="12"\n'),
    ).toThrow(/requires ubuntu 24\.04/u);
    expect(() => assertLinuxBuildHost('debian12', 'linux', 'ID=debian\nVERSION_ID="13"\n')).toThrow(
      /requires debian 12/u,
    );
    expect(() => assertLinuxBuildHost('debian12', 'darwin', '')).toThrow(/matching native/u);
    expect(() => assertLinuxBuildHost('fedora', 'linux', 'ID=fedora\nVERSION_ID="43"\n')).toThrow(
      /Unsupported Linux distribution target/u,
    );
  });
});
