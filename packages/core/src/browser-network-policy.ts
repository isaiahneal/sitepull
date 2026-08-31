import type { BrowserContext, LaunchOptions } from 'playwright';

function untrustedPageNetworkGuard(engine: 'webkit' | 'chromium' | 'firefox'): string {
  const workerConstructors = engine === 'webkit' ? ", 'Worker', 'SharedWorker'" : '';
  return `(() => {
  const blockedConstructors = [
    'RTCPeerConnection',
    'webkitRTCPeerConnection',
    'RTCIceGatherer',
    'RTCIceTransport',
    'WebTransport',
    'TCPSocket',
    'UDPSocket'${workerConstructors}
  ];
  for (const name of blockedConstructors) {
    try {
      Object.defineProperty(globalThis, name, {
        value: undefined,
        writable: false,
        enumerable: false,
        configurable: false
      });
    } catch {
      // Engine-level launch policy remains a second line of defense where supported.
    }
  }
})();`;
}

/** Browser launch policy for transports that do not obey an HTTP proxy. */
export function untrustedBrowserLaunchOptions(
  engine: 'webkit' | 'chromium' | 'firefox',
  headed: boolean,
  options: Readonly<{ systemChromium?: boolean }> = {},
): LaunchOptions {
  const common: LaunchOptions = { headless: !headed };
  if (engine === 'chromium') {
    const systemChromium = options.systemChromium === true;
    return {
      ...common,
      chromiumSandbox: true,
      args: [
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        ...(systemChromium && !headed
          ? ['--use-gl=disabled', '--disable-software-rasterizer']
          : []),
      ],
      ...(systemChromium ? { ignoreDefaultArgs: ['--enable-unsafe-swiftshader'] } : {}),
    };
  }
  if (engine === 'firefox') {
    return {
      ...common,
      firefoxUserPrefs: {
        'media.peerconnection.enabled': false,
        'network.http.http3.enable': false,
      },
    };
  }
  return common;
}

/** Installs before site scripts in every page and child frame in the context. */
export async function installUntrustedPageNetworkGuards(
  context: BrowserContext,
  engine: 'webkit' | 'chromium' | 'firefox',
): Promise<void> {
  await context.addInitScript({ content: untrustedPageNetworkGuard(engine) });
}
