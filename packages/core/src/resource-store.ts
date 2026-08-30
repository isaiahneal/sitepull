import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ResourceKind as ContractResourceKind,
  ResourceManifestEntry,
} from '@sitepull/contracts';

import type { CapturedResourcePayload } from './capture-page.js';
import type { ProjectWriter } from './project.js';
import {
  classifyResource,
  deterministicAssetPath,
  sha256Hex,
  type ResourceKind,
} from './resources.js';

interface MutableResource {
  originalUrl: string;
  finalUrl?: string;
  kind: ContractResourceKind;
  contentType: string | null;
  httpStatus: number;
  localPath: string | null;
  byteSize: number;
  sha256: string | null;
  referencedByPages: Set<string>;
  captured: boolean;
  failureReason?: string;
}

export interface StoredResourceResult {
  readonly sha256: string | null;
  readonly localPath: string | null;
  readonly sourceMapUrl: string | null;
  readonly newlyWritten: boolean;
}

function contractKind(kind: ResourceKind, url: string): ContractResourceKind {
  if (/\.map(?:$|[?#])/iu.test(url)) return 'source-map';
  if (kind === 'media' || kind === 'document') return 'other';
  return kind;
}

function explicitSourceMapUrl(
  body: Buffer,
  contentType: string | null,
  resourceUrl: string,
): string | null {
  const type = contentType?.toLowerCase() ?? '';
  if (!type.includes('javascript') && !/\.(?:m?js)(?:$|[?#])/iu.test(resourceUrl)) return null;
  const tail = body.subarray(Math.max(0, body.byteLength - 8_192)).toString('utf8');
  const matches = [
    ...tail.matchAll(/(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=\s*([^\s*]+)(?:\s*\*\/)?/gu),
  ];
  const raw = matches.at(-1)?.[1]?.trim();
  if (raw === undefined || raw.startsWith('data:')) return null;
  try {
    const resolved = new URL(raw, resourceUrl);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : null;
  } catch {
    return null;
  }
}

export class ResourceStore {
  readonly #writer: ProjectWriter;
  readonly #resources = new Map<string, MutableResource>();
  readonly #hashPaths = new Map<string, string>();
  readonly #writePromises = new Map<string, Promise<void>>();

  constructor(writer: ProjectWriter) {
    this.#writer = writer;
  }

  get count(): number {
    return this.#resources.size;
  }

  get capturedCount(): number {
    return [...this.#resources.values()].filter((resource) => resource.captured).length;
  }

  get uniqueAssetCount(): number {
    return this.#hashPaths.size;
  }

  get totalUniqueBytes(): number {
    const sizes = new Map<string, number>();
    for (const resource of this.#resources.values()) {
      if (resource.sha256 !== null && !sizes.has(resource.sha256))
        sizes.set(resource.sha256, resource.byteSize);
    }
    return [...sizes.values()].reduce((sum, size) => sum + size, 0);
  }

  async record(payload: CapturedResourcePayload): Promise<StoredResourceResult> {
    let parsed: URL;
    try {
      parsed = new URL(payload.originalUrl);
    } catch {
      return { sha256: null, localPath: null, sourceMapUrl: null, newlyWritten: false };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { sha256: null, localPath: null, sourceMapUrl: null, newlyWritten: false };
    }

    const existing = this.#resources.get(payload.originalUrl);
    if (existing !== undefined) {
      existing.referencedByPages.add(payload.referencedByPage);
      return {
        sha256: existing.sha256,
        localPath: existing.localPath,
        sourceMapUrl:
          payload.body === null
            ? null
            : explicitSourceMapUrl(payload.body, payload.contentType, payload.finalUrl),
        newlyWritten: false,
      };
    }

    const internalKind = classifyResource({
      url: payload.finalUrl,
      contentType: payload.contentType,
    });
    const kind = contractKind(internalKind, payload.finalUrl);
    if (payload.body === null) {
      this.#resources.set(payload.originalUrl, {
        originalUrl: payload.originalUrl,
        ...(payload.finalUrl === payload.originalUrl ? {} : { finalUrl: payload.finalUrl }),
        kind,
        contentType: payload.contentType,
        httpStatus: payload.status,
        localPath: null,
        byteSize: 0,
        sha256: null,
        referencedByPages: new Set([payload.referencedByPage]),
        captured: false,
        failureReason: payload.failureReason ?? 'Response body was unavailable.',
      });
      return { sha256: null, localPath: null, sourceMapUrl: null, newlyWritten: false };
    }

    const body = payload.body;
    const sha256 = sha256Hex(body);
    const existingPath = this.#hashPaths.get(sha256);
    const localPath =
      existingPath ??
      deterministicAssetPath({
        url: payload.finalUrl,
        contentType: payload.contentType,
        sha256,
      });
    let newlyWritten = false;
    if (existingPath === undefined) {
      this.#hashPaths.set(sha256, localPath);
      const destination = this.#writer.resolve(localPath);
      const pending = (async () => {
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, body, { flag: 'wx' });
      })();
      this.#writePromises.set(sha256, pending);
      await pending;
      newlyWritten = true;
    } else {
      await this.#writePromises.get(sha256);
    }

    this.#resources.set(payload.originalUrl, {
      originalUrl: payload.originalUrl,
      ...(payload.finalUrl === payload.originalUrl ? {} : { finalUrl: payload.finalUrl }),
      kind,
      contentType: payload.contentType,
      httpStatus: payload.status,
      localPath,
      byteSize: body.byteLength,
      sha256,
      referencedByPages: new Set([payload.referencedByPage]),
      captured: true,
    });
    return {
      sha256,
      localPath,
      sourceMapUrl: explicitSourceMapUrl(body, payload.contentType, payload.finalUrl),
      newlyWritten,
    };
  }

  entries(): ResourceManifestEntry[] {
    return [...this.#resources.values()]
      .map((resource) => ({
        originalUrl: resource.originalUrl,
        ...(resource.finalUrl === undefined ? {} : { finalUrl: resource.finalUrl }),
        kind: resource.kind,
        contentType: resource.contentType,
        httpStatus: resource.httpStatus,
        localPath: resource.localPath,
        byteSize: resource.byteSize,
        sha256: resource.sha256,
        referencedByPages: [...resource.referencedByPages].sort(),
        captured: resource.captured,
        ...(resource.failureReason === undefined ? {} : { failureReason: resource.failureReason }),
      }))
      .sort((left, right) => left.originalUrl.localeCompare(right.originalUrl));
  }
}
