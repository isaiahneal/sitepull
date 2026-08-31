import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const ASSETS_ROOT = path.resolve(import.meta.dirname, 'assets');

export const DESKTOP_ICON_PATHS = {
  darwin: path.join(ASSETS_ROOT, 'sitepull.icns'),
  linux: path.join(ASSETS_ROOT, 'sitepull.png'),
  win32: path.join(ASSETS_ROOT, 'sitepull.ico'),
} as const;

// Keep this aligned with Playwright's ubuntu24.04 WebKit runtime dependency
// list. The DEB is explicitly built and clean-install tested for Ubuntu 24.04.
export const PLAYWRIGHT_WEBKIT_UBUNTU_24_DEPENDENCIES = [
  'gstreamer1.0-libav',
  'gstreamer1.0-plugins-bad',
  'gstreamer1.0-plugins-base',
  'gstreamer1.0-plugins-good',
  'libatomic1',
  'libatk-bridge2.0-0t64',
  'libatk1.0-0t64',
  'libavif16',
  'libcairo-gobject2',
  'libcairo2',
  'libdbus-1-3',
  'libdrm2',
  'libenchant-2-2',
  'libepoxy0',
  'libevent-2.1-7t64',
  'libflite1',
  'libfontconfig1',
  'libfreetype6',
  'libgbm1',
  'libgdk-pixbuf-2.0-0',
  'libgles2',
  'libglib2.0-0t64',
  'libgstreamer-gl1.0-0',
  'libgstreamer-plugins-bad1.0-0',
  'libgstreamer-plugins-base1.0-0',
  'libgstreamer1.0-0',
  'libgtk-4-1',
  'libharfbuzz-icu0',
  'libharfbuzz0b',
  'libhyphen0',
  'libicu74',
  'libjpeg-turbo8',
  'liblcms2-2',
  'libmanette-0.2-0',
  'libopus0',
  'libpango-1.0-0',
  'libpangocairo-1.0-0',
  'libpng16-16t64',
  'libsecret-1-0',
  'libvpx9',
  'libwayland-client0',
  'libwayland-egl1',
  'libwayland-server0',
  'libwebp7',
  'libwebpdemux2',
  'libwoff1',
  'libx11-6',
  'libx264-164',
  'libxkbcommon0',
  'libxml2',
  'libxslt1.1',
] as const;

export const PLAYWRIGHT_WEBKIT_FONT_RECOMMENDATIONS = [
  'fonts-freefont-ttf',
  'fonts-ipafont-gothic',
  'fonts-liberation',
  'fonts-noto-color-emoji',
  'fonts-tlwg-loma-otf',
  'fonts-unifont',
  'fonts-wqy-zenhei',
  'xfonts-cyrillic',
  'xfonts-scalable',
] as const;

export function desktopIconForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return DESKTOP_ICON_PATHS.darwin;
  if (platform === 'win32') return DESKTOP_ICON_PATHS.win32;
  return DESKTOP_ICON_PATHS.linux;
}

export interface PnpmInvocation {
  command: string;
  prefixArgs: string[];
}

export const PRODUCTION_DEPLOY_ARGS = [
  '--config.inject-workspace-packages=true',
  '--filter',
  '@sitepull/desktop',
  'deploy',
  '--prod',
] as const;

export function productionDeployEnvironment(
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnvironment,
    CI: 'true',
    // Deployment is isolated in its temporary target. Do not let pnpm run a
    // separate workspace verification install before creating that target.
    pnpm_config_verify_deps_before_run: 'false',
  };
}

export function resolvePnpmInvocation(
  platform: NodeJS.Platform,
  npmExecPath: string | undefined,
  nodeExecutable = process.execPath,
  pnpmHome?: string,
): PnpmInvocation {
  if (npmExecPath !== undefined) {
    const pathImplementation = platform === 'win32' ? path.win32 : path.posix;
    if (
      pathImplementation.isAbsolute(npmExecPath) &&
      /\.(?:c|m)?js$/i.test(pathImplementation.extname(npmExecPath))
    ) {
      return { command: nodeExecutable, prefixArgs: [npmExecPath] };
    }
  }

  if (platform === 'win32') {
    if (pnpmHome !== undefined && path.win32.isAbsolute(pnpmHome)) {
      return { command: path.win32.join(pnpmHome, 'pnpm.exe'), prefixArgs: [] };
    }
    throw new Error(
      'Windows packaging requires an absolute npm_execpath or PNPM_HOME so pnpm can run without shell command parsing.',
    );
  }
  return { command: 'pnpm', prefixArgs: [] };
}

export function packagedMacAppPath(outputPath: string): string {
  const absoluteOutputPath = path.resolve(outputPath);
  return absoluteOutputPath.endsWith('.app')
    ? absoluteOutputPath
    : path.join(absoluteOutputPath, 'Sitepull.app');
}

async function adHocResignMacApp(appPath: string): Promise<void> {
  const appStats = await stat(appPath);
  if (!appStats.isDirectory() || path.extname(appPath) !== '.app') {
    throw new Error(`Refusing to sign an invalid macOS application path: ${appPath}`);
  }
  await execFileAsync(
    '/usr/bin/codesign',
    [
      '--force',
      '--deep',
      '--sign',
      '-',
      '--timestamp=none',
      '--preserve-metadata=entitlements,flags,runtime',
      appPath,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  await execFileAsync(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    { maxBuffer: 10 * 1024 * 1024 },
  );
}

async function stageProductionDependencies(buildPath: string): Promise<void> {
  const deployPath = await mkdtemp(path.join(os.tmpdir(), 'sitepull-forge-deploy-'));
  const pnpm = resolvePnpmInvocation(
    process.platform,
    process.env.npm_execpath,
    process.execPath,
    process.env.PNPM_HOME,
  );

  try {
    await execFileAsync(pnpm.command, [...pnpm.prefixArgs, ...PRODUCTION_DEPLOY_ARGS, deployPath], {
      cwd: WORKSPACE_ROOT,
      env: productionDeployEnvironment(),
      maxBuffer: 10 * 1024 * 1024,
    });

    const destination = path.join(buildPath, 'node_modules');
    await mkdir(destination, { recursive: true });
    await cp(path.join(deployPath, 'node_modules'), destination, {
      recursive: true,
      dereference: true,
    });

    // Neither command shims nor the CLI package are runtime dependencies here.
    await Promise.all([
      rm(path.join(destination, '.bin'), { recursive: true, force: true }),
      rm(path.join(destination, '@sitepull', 'cli'), {
        recursive: true,
        force: true,
      }),
    ]);
  } finally {
    await rm(deployPath, { recursive: true, force: true });
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Sitepull',
    executableName: 'Sitepull',
    icon: desktopIconForPlatform(process.platform),
    asar: true,
    derefSymlinks: true,
    extraResource: [
      path.resolve(import.meta.dirname, '.playwright-browsers'),
      DESKTOP_ICON_PATHS.linux,
    ],
    appBundleId: 'com.isaiahneal.sitepull',
    appCategoryType: 'public.app-category.developer-tools',
    win32metadata: {
      CompanyName: 'Isaiah Neal',
      FileDescription: 'Sitepull',
      OriginalFilename: 'Sitepull.exe',
      ProductName: 'Sitepull',
      InternalName: 'Sitepull',
      'requested-execution-level': 'asInvoker',
    },
  },
  rebuildConfig: {},
  hooks: {
    // Forge's Vite plugin intentionally copies only `.vite`. The main bundle
    // externalizes Playwright and Archiver, so add a physical production
    // dependency closure after the packager's source filtering has completed.
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      await stageProductionDependencies(buildPath);
    },
    // Fuses and the packager both mutate signed bundle contents. Re-sign only
    // after those mutations, then prove the ad-hoc bundle is internally valid
    // before a DMG or ZIP maker consumes it.
    postPackage: async (_forgeConfig, packageResult) => {
      if (packageResult.platform !== 'darwin') return;
      for (const outputPath of packageResult.outputPaths) {
        await adHocResignMacApp(packagedMacAppPath(outputPath));
      }
    },
  },
  makers: [
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
    new MakerDMG(
      {
        name: 'Sitepull',
        format: 'ULFO',
      },
      ['darwin'],
    ),
    new MakerDeb(
      {
        options: {
          name: 'sitepull',
          productName: 'Sitepull',
          genericName: 'Website Capture Utility',
          description: 'Capture browser-delivered design references.',
          productDescription:
            'Sitepull captures inspectable local artifacts from browser-delivered websites.',
          section: 'devel',
          priority: 'optional',
          maintainer: 'Isaiah Neal',
          homepage: 'https://github.com/isaiahneal/sitepull',
          bin: 'Sitepull',
          icon: DESKTOP_ICON_PATHS.linux,
          categories: ['Development', 'Utility'],
          depends: [...PLAYWRIGHT_WEBKIT_UBUNTU_24_DEPENDENCIES],
          recommends: [...PLAYWRIGHT_WEBKIT_FONT_RECOMMENDATIONS],
          suggests: ['xvfb'],
        },
      },
      ['linux'],
    ),
    new MakerSquirrel(
      {
        name: 'sitepull',
        title: 'Sitepull',
        authors: 'Isaiah Neal',
        owners: 'Isaiah Neal',
        copyright: 'Copyright (c) 2026 Isaiah Neal',
        description:
          'Capture browser-delivered design references into inspectable local artifacts.',
        exe: 'Sitepull.exe',
        setupIcon: DESKTOP_ICON_PATHS.win32,
        setupExe: 'SitepullSetup.exe',
        noMsi: true,
        noDelta: false,
      },
      ['win32'],
    ),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
