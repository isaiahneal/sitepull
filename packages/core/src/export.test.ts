import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { exportCaptureArchive, selectExportFiles } from './export.js';

const roots: string[] = [];

async function fixtureCapture(): Promise<string> {
  const root = path.join(os.tmpdir(), `sitepull-export-${crypto.randomUUID()}`);
  roots.push(root);
  await mkdir(path.join(root, 'design'), { recursive: true });
  await mkdir(path.join(root, 'pages/home/screenshots'), { recursive: true });
  await mkdir(path.join(root, 'raw/javascript'), { recursive: true });
  await writeFile(path.join(root, 'AI_CONTEXT.md'), '# Reference');
  await writeFile(path.join(root, 'manifest.json'), '{}');
  await writeFile(path.join(root, 'design/colors.json'), '[]');
  await writeFile(path.join(root, 'pages/home/rendered.html'), '<main/>');
  await writeFile(path.join(root, 'pages/home/network.json'), '[]');
  await writeFile(
    path.join(root, 'pages/home/screenshots/desktop.png'),
    Buffer.from([137, 80, 78, 71]),
  );
  await writeFile(path.join(root, 'raw/javascript/app.js'), 'minified()');
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('AI Pack export', () => {
  it('uses an explicit allowlist that omits raw JavaScript and network dumps', async () => {
    const root = await fixtureCapture();
    const selection = await selectExportFiles(root, 'ai-pack');
    expect(selection.files).toContain('AI_CONTEXT.md');
    expect(selection.files).toContain('pages/home/rendered.html');
    expect(selection.files).not.toContain('pages/home/network.json');
    expect(selection.files).not.toContain('raw/javascript/app.js');
    expect(selection.estimatedCompressedBytes).toBeGreaterThan(0);
  });

  it('creates a non-empty deterministic-path archive', async () => {
    const root = await fixtureCapture();
    const destination = path.join(root, '..', `${path.basename(root)}.zip`);
    roots.push(destination);
    const result = await exportCaptureArchive({ captureRoot: root, mode: 'ai-pack', destination });
    expect(result.compressedBytes).toBeGreaterThan(100);
    expect(result.archivePath).toBe(destination);
  });
});
