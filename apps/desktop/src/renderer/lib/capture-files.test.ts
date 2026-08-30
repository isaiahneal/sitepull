import { describe, expect, it } from 'vitest';

import { buildCaptureTree, type CaptureFileRecord } from './capture-files.js';

describe('capture file tree', () => {
  it('builds a deterministic directory-first hierarchy from safe paths', () => {
    const files: CaptureFileRecord[] = [
      { path: 'README.md', preview: 'text' },
      { path: 'pages/home/rendered.html', preview: 'text' },
      { path: 'pages/home/screenshots/desktop.png', preview: 'image' },
      { path: 'design/colors.json', preview: 'text' },
    ];
    const tree = buildCaptureTree(files);
    expect(tree.map((node) => node.name)).toEqual(['design', 'pages', 'README.md']);
    expect(tree[1]?.children[0]?.path).toBe('pages/home');
    expect(tree[1]?.children[0]?.children.map((node) => node.name)).toEqual([
      'screenshots',
      'rendered.html',
    ]);
  });
});
