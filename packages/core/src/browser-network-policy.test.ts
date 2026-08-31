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

  it('keeps headless system Chromium off the unsafe 3D software-rendering path', () => {
    expect(untrustedBrowserLaunchOptions('chromium', false, { systemChromium: true })).toEqual({
      headless: true,
      chromiumSandbox: true,
      args: [
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-software-rasterizer',
      ],
      ignoreDefaultArgs: ['--enable-unsafe-swiftshader'],
    });
  });

  it('preserves system graphics in headed Chromium without opting into unsafe SwiftShader', () => {
    expect(untrustedBrowserLaunchOptions('chromium', true, { systemChromium: true })).toEqual({
      headless: false,
      chromiumSandbox: true,
      args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
      ignoreDefaultArgs: ['--enable-unsafe-swiftshader'],
    });
  });

  it('preserves headed mode for explicit interactive captures', () => {
    expect(untrustedBrowserLaunchOptions('webkit', true)).toEqual({ headless: false });
  });
});
