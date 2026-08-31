import { describe, expect, it } from 'vitest';

import { untrustedBrowserLaunchOptions } from './browser-network-policy.js';

describe('untrusted browser launch policy', () => {
  it('keeps Chromium headless and sandboxed while disabling bypass transports', () => {
    expect(untrustedBrowserLaunchOptions('chromium', false)).toEqual({
      headless: true,
      chromiumSandbox: true,
      args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    });
  });

  it('preserves headed mode for explicit interactive captures', () => {
    expect(untrustedBrowserLaunchOptions('webkit', true)).toEqual({ headless: false });
  });
});
