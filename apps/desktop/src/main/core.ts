async function importCore() {
  return import('@sitepull/core');
}

export type SitepullCoreModule = Awaited<ReturnType<typeof importCore>>;

let coreModulePromise: Promise<SitepullCoreModule> | undefined;

/** Defers Playwright evaluation until the packaged browser path has been configured. */
export function loadCore(): Promise<SitepullCoreModule> {
  coreModulePromise ??= importCore();
  return coreModulePromise;
}
