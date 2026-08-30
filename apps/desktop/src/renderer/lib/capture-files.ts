import type { CaptureManifest } from '@sitepull/contracts';

import { isCaptureScreenshotPath, isTextPreviewable } from './utils.js';

export const CAPTURE_RESOURCE_FILE_LIMIT = 1_000;

export interface CaptureFileRecord {
  readonly path: string;
  readonly byteSize?: number;
  readonly preview: 'text' | 'image' | 'binary';
}

export interface CaptureTreeNode {
  readonly name: string;
  readonly path: string;
  readonly kind: 'directory' | 'file';
  readonly children: CaptureTreeNode[];
  readonly file?: CaptureFileRecord;
}

function previewKind(path: string): CaptureFileRecord['preview'] {
  if (isCaptureScreenshotPath(path)) return 'image';
  return isTextPreviewable(path) ? 'text' : 'binary';
}

export function collectCaptureFiles(manifest: CaptureManifest): CaptureFileRecord[] {
  const files = new Map<string, CaptureFileRecord>();
  const add = (path: string | null | undefined, byteSize?: number) => {
    if (!path || files.has(path)) return;
    files.set(path, {
      path,
      preview: previewKind(path),
      ...(byteSize === undefined ? {} : { byteSize }),
    });
  };

  add(manifest.artifacts.readme);
  add(manifest.artifacts.aiContext);
  add(manifest.artifacts.sitepullMetadata);
  add(manifest.artifacts.manifest);
  add('assets/manifest.json');
  add('logs/sitepull.jsonl');

  for (const path of Object.values(manifest.designFiles)) add(path);
  for (const page of manifest.pages) {
    if (page.files) for (const path of Object.values(page.files)) add(path);
    for (const screenshot of page.screenshots) {
      add(screenshot.viewportPath, screenshot.viewportByteSize);
      add(screenshot.fullPagePath, screenshot.fullPageByteSize);
    }
  }
  const localResources = new Map<string, number>();
  for (const resource of manifest.resources) {
    if (resource.localPath !== null && !localResources.has(resource.localPath)) {
      localResources.set(resource.localPath, resource.byteSize);
    }
  }
  for (const [path, byteSize] of [...localResources].slice(0, CAPTURE_RESOURCE_FILE_LIMIT)) {
    add(path, byteSize);
  }

  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

interface MutableNode {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  children: Map<string, MutableNode>;
  file?: CaptureFileRecord;
}

export function buildCaptureTree(files: CaptureFileRecord[]): CaptureTreeNode[] {
  const root = new Map<string, MutableNode>();
  for (const file of files) {
    const parts = file.path.split('/');
    let level = root;
    let currentPath = '';
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = level.get(part);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          kind: isFile ? 'file' : 'directory',
          children: new Map(),
          ...(isFile ? { file } : {}),
        };
        level.set(part, node);
      }
      level = node.children;
    });
  }

  const freeze = (nodes: Map<string, MutableNode>): CaptureTreeNode[] =>
    [...nodes.values()]
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((node) => ({
        name: node.name,
        path: node.path,
        kind: node.kind,
        children: freeze(node.children),
        ...(node.file ? { file: node.file } : {}),
      }));
  return freeze(root);
}
