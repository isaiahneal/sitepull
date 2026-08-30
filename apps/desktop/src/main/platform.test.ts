import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  desktopWindowChrome,
  desktopWindowIconPath,
  shouldHandleSquirrelStartup,
  SITEPULL_APP_ID,
} from './platform.js';

describe('desktop platform integration', () => {
  it('uses a stable Windows application identifier', () => {
    expect(SITEPULL_APP_ID).toBe('com.isaiahneal.sitepull');
  });

  it('resolves the packaged icon from Electron resources', () => {
    expect(desktopWindowIconPath(true, '/opt/Sitepull/resources', '/ignored')).toBe(
      path.join('/opt/Sitepull/resources', 'sitepull.png'),
    );
  });

  it('resolves the development icon from the desktop app root', () => {
    expect(desktopWindowIconPath(false, '/ignored', '/workspace/apps/desktop')).toBe(
      path.join('/workspace/apps/desktop', 'assets', 'sitepull.png'),
    );
  });

  it('limits inset chrome and traffic lights to macOS', () => {
    expect(desktopWindowChrome('darwin', '/icon.png')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
    });
  });

  it.each(['linux', 'win32'] as const)('uses native chrome and an icon on %s', (platform) => {
    expect(desktopWindowChrome(platform, '/icon.png')).toEqual({
      titleBarStyle: 'default',
      icon: '/icon.png',
    });
  });

  it('handles Squirrel lifecycle launches only on Windows', () => {
    expect(shouldHandleSquirrelStartup('win32', true)).toBe(true);
    expect(shouldHandleSquirrelStartup('win32', false)).toBe(false);
    expect(shouldHandleSquirrelStartup('darwin', true)).toBe(false);
    expect(shouldHandleSquirrelStartup('linux', true)).toBe(false);
  });
});
