import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import forgeConfig, {
  DESKTOP_ICON_PATHS,
  PRODUCTION_DEPLOY_ARGS,
  desktopIconForPlatform,
  packagedMacAppPath,
  productionDeployEnvironment,
  resolvePnpmInvocation,
} from '../../forge.config.js';

interface ConfiguredMaker {
  name: string;
  platforms: string[];
}

describe('Electron Forge distribution configuration', () => {
  it('configures the exact native maker matrix', () => {
    const makers = (forgeConfig.makers ?? []) as ConfiguredMaker[];
    expect(makers.map(({ name, platforms }) => ({ name, platforms }))).toEqual([
      { name: 'zip', platforms: ['darwin', 'linux', 'win32'] },
      { name: 'dmg', platforms: ['darwin'] },
      { name: 'deb', platforms: ['linux'] },
      { name: 'rpm', platforms: ['linux'] },
      { name: 'squirrel', platforms: ['win32'] },
    ]);
  });

  it('uses native icon formats with valid file signatures', () => {
    expect(readFileSync(DESKTOP_ICON_PATHS.darwin).subarray(0, 4).toString('ascii')).toBe('icns');
    expect([...readFileSync(DESKTOP_ICON_PATHS.linux).subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect([...readFileSync(DESKTOP_ICON_PATHS.win32).subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(desktopIconForPlatform('darwin')).toBe(DESKTOP_ICON_PATHS.darwin);
    expect(desktopIconForPlatform('linux')).toBe(DESKTOP_ICON_PATHS.linux);
    expect(desktopIconForPlatform('win32')).toBe(DESKTOP_ICON_PATHS.win32);
  });

  it('stages the portable icon and verifies macOS after packaging mutations', () => {
    expect(forgeConfig.packagerConfig?.extraResource).toContain(DESKTOP_ICON_PATHS.linux);
    expect(forgeConfig.hooks?.packageAfterPrune).toBeTypeOf('function');
    expect(forgeConfig.hooks?.postPackage).toBeTypeOf('function');
    expect(packagedMacAppPath('/tmp/Sitepull-darwin-arm64')).toBe(
      '/tmp/Sitepull-darwin-arm64/Sitepull.app',
    );
    expect(packagedMacAppPath('/tmp/Sitepull.app')).toBe('/tmp/Sitepull.app');
  });

  it('runs pnpm through Node on Windows without shell command parsing', () => {
    expect(resolvePnpmInvocation('win32', 'C:\\pnpm\\pnpm.cjs', 'C:\\node\\node.exe')).toEqual({
      command: 'C:\\node\\node.exe',
      prefixArgs: ['C:\\pnpm\\pnpm.cjs'],
    });
    expect(
      resolvePnpmInvocation(
        'win32',
        undefined,
        'C:\\node\\node.exe',
        'C:\\Users\\runneradmin\\setup-pnpm',
      ),
    ).toEqual({
      command: 'C:\\Users\\runneradmin\\setup-pnpm\\pnpm.exe',
      prefixArgs: [],
    });
    expect(resolvePnpmInvocation('linux', undefined, '/usr/bin/node')).toEqual({
      command: 'pnpm',
      prefixArgs: [],
    });
    expect(() =>
      resolvePnpmInvocation('win32', undefined, 'C:\\node\\node.exe', undefined),
    ).toThrow(/npm_execpath or PNPM_HOME/);
    expect(() =>
      resolvePnpmInvocation('win32', undefined, 'C:\\node\\node.exe', 'relative\\pnpm'),
    ).toThrow(/npm_execpath or PNPM_HOME/);
  });

  it('keeps production deployment from changing the shared workspace install', () => {
    expect(PRODUCTION_DEPLOY_ARGS).toContain('--config.inject-workspace-packages=true');
    expect(PRODUCTION_DEPLOY_ARGS).not.toContain('--legacy');
    expect(productionDeployEnvironment({ SITEPULL_TEST: 'preserved' })).toEqual({
      SITEPULL_TEST: 'preserved',
      CI: 'true',
      pnpm_config_verify_deps_before_run: 'false',
    });
  });
});
