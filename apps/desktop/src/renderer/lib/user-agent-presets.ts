export interface UserAgentPreset {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly value: string;
}

/**
 * Snapshot from the Playwright 1.62.1 device catalog shipped with Sitepull 0.5.
 * Recipes persist the effective string, so updating this list never changes an
 * existing Capture Again recipe.
 */
export const USER_AGENT_PRESETS = [
  {
    id: 'safari-desktop',
    label: 'Safari · macOS',
    detail: 'Desktop Safari compatibility string',
    value:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15',
  },
  {
    id: 'safari-iphone',
    label: 'Safari · iPhone',
    detail: 'Mobile Safari compatibility string',
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'chrome-desktop',
    label: 'Chrome · Windows',
    detail: 'Desktop Chrome compatibility string',
    value:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36',
  },
  {
    id: 'chrome-android',
    label: 'Chrome · Android',
    detail: 'Pixel 7 mobile compatibility string',
    value:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Mobile Safari/537.36',
  },
  {
    id: 'firefox-desktop',
    label: 'Firefox · Windows',
    detail: 'Desktop Firefox compatibility string',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0',
  },
] as const satisfies readonly UserAgentPreset[];

export type UserAgentChoice =
  'browser-default' | 'custom' | (typeof USER_AGENT_PRESETS)[number]['id'];

export function userAgentPreset(value: string | null): UserAgentPreset | null {
  if (value === null) return null;
  return USER_AGENT_PRESETS.find((preset) => preset.value === value) ?? null;
}

export function userAgentChoice(value: string | null): UserAgentChoice {
  if (value === null) return 'browser-default';
  return (userAgentPreset(value)?.id ?? 'custom') as UserAgentChoice;
}

export function userAgentChoiceLabel(choice: UserAgentChoice): string {
  if (choice === 'browser-default') return 'Browser UA';
  if (choice === 'custom') return 'Custom UA';
  return USER_AGENT_PRESETS.find((preset) => preset.id === choice)?.label ?? 'Custom UA';
}
