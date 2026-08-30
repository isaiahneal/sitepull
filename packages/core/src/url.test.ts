import { describe, expect, it } from 'vitest';

import {
  BoundedUrlFrontier,
  canonicalizeUrl,
  evaluateDiscoveredUrl,
  isAllowedByOrigin,
} from './url.js';

describe('canonicalizeUrl', () => {
  it('resolves relative links, strips fragments and tracking, and sorts retained parameters', () => {
    expect(
      canonicalizeUrl('../pricing?z=2&utm_source=test&a=1&fbclid=nope#plans', {
        baseUrl: 'https://EXAMPLE.com:443/docs/start',
      }),
    ).toBe('https://example.com/pricing?a=1&z=2');
  });

  it('rejects non-HTTP schemes and embedded credentials', () => {
    expect(() => canonicalizeUrl('file:///etc/passwd')).toThrow(/only supports HTTP and HTTPS/i);
    expect(() => canonicalizeUrl('https://user:secret@example.com/')).toThrow(
      /embedded credentials/i,
    );
  });
});

describe('origin and discovery policy', () => {
  it('allows explicit subdomains but not deceptive suffixes, ports, or protocol changes', () => {
    const policy = { originUrl: 'https://example.com', includeSubdomains: true } as const;
    expect(isAllowedByOrigin('https://docs.example.com/guide', policy)).toBe(true);
    expect(isAllowedByOrigin('https://example.com.evil.test/', policy)).toBe(false);
    expect(isAllowedByOrigin('https://example.com:8443/', policy)).toBe(false);
    expect(isAllowedByOrigin('http://example.com/', policy)).toBe(false);
  });

  it('records ordinary skip reasons rather than throwing', () => {
    const policy = { originUrl: 'https://example.com/' };
    expect(
      evaluateDiscoveredUrl('mailto:test@example.com', policy.originUrl, policy),
    ).toMatchObject({
      accepted: false,
      reason: 'unsupported-protocol',
    });
    expect(evaluateDiscoveredUrl('/press-kit.zip', policy.originUrl, policy)).toMatchObject({
      accepted: false,
      reason: 'download',
    });
    expect(evaluateDiscoveredUrl('/api/catalog.json', policy.originUrl, policy)).toMatchObject({
      accepted: false,
      reason: 'download',
    });
    expect(evaluateDiscoveredUrl('https://other.test/', policy.originUrl, policy)).toMatchObject({
      accepted: false,
      reason: 'external-origin',
    });
  });
});

describe('BoundedUrlFrontier', () => {
  it('deduplicates canonical routes after tracking removal', () => {
    const frontier = new BoundedUrlFrontier({ originUrl: 'https://example.com', maxUrls: 10 });

    expect(frontier.consider('/docs?utm_campaign=launch')).toEqual({
      accepted: true,
      url: 'https://example.com/docs',
    });
    expect(frontier.consider('/docs#overview')).toMatchObject({
      accepted: false,
      reason: 'duplicate',
    });
    expect(frontier.size).toBe(1);
  });

  it('bounds distinct query variants per origin and pathname', () => {
    const frontier = new BoundedUrlFrontier({
      originUrl: 'https://example.com',
      maxQueryVariantsPerPath: 2,
      maxUrls: 10,
    });

    expect(frontier.consider('/search?page=1')).toMatchObject({ accepted: true });
    expect(frontier.consider('/search?page=2')).toMatchObject({ accepted: true });
    expect(frontier.consider('/search?page=3')).toMatchObject({
      accepted: false,
      reason: 'query-variant-limit',
    });
    expect(frontier.consider('/about?page=3')).toMatchObject({ accepted: true });
  });

  it('reports the independent total-URL bound accurately', () => {
    const frontier = new BoundedUrlFrontier({ originUrl: 'https://example.com', maxUrls: 1 });
    expect(frontier.consider('/one')).toMatchObject({ accepted: true });
    expect(frontier.consider('/two')).toMatchObject({ accepted: false, reason: 'url-limit' });
  });
});
