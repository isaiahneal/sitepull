import path from 'node:path';

export const SITEPULL_APP_ID = 'com.isaiahneal.sitepull';

export interface DesktopWindowChrome {
  titleBarStyle: 'default' | 'hiddenInset';
  trafficLightPosition?: { x: number; y: number };
  icon?: string;
}

export function desktopWindowIconPath(
  isPackaged: boolean,
  resourcesPath: string,
  appPath: string,
): string {
  return isPackaged
    ? path.join(resourcesPath, 'sitepull.png')
    : path.join(appPath, 'assets', 'sitepull.png');
}

export function desktopWindowChrome(
  platform: NodeJS.Platform,
  iconPath: string,
): DesktopWindowChrome {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
    };
  }

  return {
    titleBarStyle: 'default',
    icon: iconPath,
  };
}

export function shouldHandleSquirrelStartup(
  platform: NodeJS.Platform,
  squirrelStartup: boolean,
): boolean {
  return platform === 'win32' && squirrelStartup;
}
