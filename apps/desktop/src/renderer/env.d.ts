/// <reference types="vite/client" />

import type { SitepullDesktopApi } from '@sitepull/contracts';

declare global {
  interface Window {
    readonly sitepull: SitepullDesktopApi;
  }
}

export {};
