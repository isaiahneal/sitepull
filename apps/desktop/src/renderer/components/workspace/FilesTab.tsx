import { Collapsible } from '@base-ui/react/collapsible';
import type { FilePreviewResult, IpcResult } from '@sitepull/contracts';
import {
  ChevronRight,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  Folder,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { CaptureManifest } from '@sitepull/contracts';

import {
  buildCaptureTree,
  CAPTURE_RESOURCE_FILE_LIMIT,
  collectCaptureFiles,
  type CaptureFileRecord,
  type CaptureTreeNode,
} from '../../lib/capture-files.js';
import { captureFileUrl, cn, formatBytes, formatCount, getFileExtension } from '../../lib/utils.js';
import { ArtifactImage, EmptyPanel } from './shared.js';

interface FilesTabProps {
  readonly manifest: CaptureManifest;
  readonly readCaptureFile: (relativePath: string) => Promise<IpcResult<FilePreviewResult> | null>;
}

export function FilesTab({ manifest, readCaptureFile }: FilesTabProps) {
  const files = useMemo(() => collectCaptureFiles(manifest), [manifest]);
  const tree = useMemo(() => buildCaptureTree(files), [files]);
  const omittedResourceFiles = useMemo(() => {
    const localPaths = new Set(
      manifest.resources.flatMap((resource) =>
        resource.localPath === null ? [] : [resource.localPath],
      ),
    );
    return Math.max(0, localPaths.size - CAPTURE_RESOURCE_FILE_LIMIT);
  }, [manifest.resources]);
  const initialPath =
    files.find((file) => file.path === manifest.artifacts.aiContext)?.path ?? files[0]?.path ?? '';
  const [selectedPath, setSelectedPath] = useState(initialPath);
  const selected = files.find((file) => file.path === selectedPath);
  const [previewState, setPreviewState] = useState<{
    path: string;
    preview: FilePreviewResult | null;
    loading: boolean;
    error: string | null;
  }>(() => ({
    path: initialPath,
    preview: null,
    loading: files.find((file) => file.path === initialPath)?.preview === 'text',
    error: null,
  }));

  useEffect(() => {
    if (!selected || selected.preview !== 'text') return;
    let current = true;
    void readCaptureFile(selected.path)
      .then((response) => {
        if (!current) return;
        const next = !response
          ? { preview: null, error: 'The capture file is no longer available.' }
          : response.ok
            ? { preview: response.data, error: null }
            : { preview: null, error: response.error.message };
        setPreviewState((state) =>
          state.path === selected.path ? { path: selected.path, loading: false, ...next } : state,
        );
      })
      .catch((reason: unknown) => {
        if (!current) return;
        setPreviewState((state) =>
          state.path === selected.path
            ? {
                path: selected.path,
                preview: null,
                loading: false,
                error:
                  reason instanceof Error
                    ? reason.message
                    : 'The file preview could not be loaded.',
              }
            : state,
        );
      });
    return () => {
      current = false;
    };
  }, [readCaptureFile, selected]);

  const selectFile = (path: string) => {
    const file = files.find((entry) => entry.path === path);
    setSelectedPath(path);
    setPreviewState({
      path,
      preview: null,
      loading: file?.preview === 'text',
      error: null,
    });
  };

  const { preview, loading, error } = previewState;

  if (files.length === 0) {
    return (
      <div className="rounded-[11px] border border-white/[0.07] bg-white/[0.018]">
        <EmptyPanel
          icon={File}
          title="No project files"
          detail="The capture manifest does not reference any readable artifacts."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[570px] overflow-hidden rounded-[11px] border border-white/[0.07] bg-[#0b0c0f] max-md:flex-col">
      <aside className="flex w-[250px] shrink-0 flex-col border-r border-white/[0.065] bg-[#0d0e12] max-md:h-[210px] max-md:w-full max-md:border-b max-md:border-r-0">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-3">
          <Folder className="size-3.5 text-zinc-600" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-550">
            Capture project
          </span>
          <span className="ml-auto text-[9px] text-zinc-700">{files.length}</span>
        </div>
        {omittedResourceFiles > 0 ? (
          <div className="border-b border-amber-400/10 bg-amber-400/[0.045] px-3 py-2 text-[8px] leading-3 text-amber-300/65">
            {formatCount(omittedResourceFiles)} additional resource files remain available in the
            capture folder.
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto p-1.5 font-mono">
          {tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              onSelect={selectFile}
            />
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[43px] shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#101115] px-3">
          {selected ? <FileIcon file={selected} /> : null}
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">
            {selected?.path}
          </span>
          {selected?.byteSize !== undefined ? (
            <span className="text-[9px] text-zinc-700">{formatBytes(selected.byteSize)}</span>
          ) : null}
          <span className="rounded border border-white/[0.06] px-1.5 py-0.5 text-[7px] uppercase tracking-[0.08em] text-zinc-700">
            Read only
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-[#090a0c]">
          {loading ? (
            <div className="grid h-full place-items-center text-[10px] text-zinc-650">
              <div className="text-center">
                <LoaderCircle className="mx-auto mb-2 size-4 animate-spin" />
                Reading bounded preview
              </div>
            </div>
          ) : error ? (
            <div className="grid h-full place-items-center p-6 text-center">
              <div>
                <TriangleAlert className="mx-auto mb-2 size-4 text-amber-400/70" />
                <p className="text-[11px] text-zinc-400">{error}</p>
              </div>
            </div>
          ) : selected?.preview === 'image' ? (
            <div className="h-full overflow-auto p-5">
              <ArtifactImage
                src={captureFileUrl(manifest.captureId, selected.path)}
                alt={`Preview of ${selected.path}`}
                frameClassName="mx-auto h-full min-h-[420px] w-full max-w-[1000px] rounded-[8px] border border-white/[0.075]"
              />
            </div>
          ) : selected?.preview === 'binary' ? (
            <EmptyPanel
              icon={FileArchive}
              title="Binary preview is disabled"
              detail="Sitepull keeps binary assets in the project, but never decodes them as untrusted text inside the desktop renderer."
            />
          ) : preview ? (
            <CodePreview preview={preview} />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  readonly node: CaptureTreeNode;
  readonly depth: number;
  readonly selectedPath: string;
  readonly onSelect: (path: string) => void;
}) {
  if (node.kind === 'directory') {
    return (
      <Collapsible.Root defaultOpen={depth < 2}>
        <Collapsible.Trigger
          className="file-tree-trigger flex h-7 w-full items-center gap-1 rounded-[5px] pr-2 text-[9px] text-zinc-500 outline-none hover:bg-white/[0.04] hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-blue-400/50"
          style={{ paddingLeft: `${depth * 12 + 5}px` }}
        >
          <ChevronRight className="file-tree-chevron size-3 shrink-0 transition-transform" />
          <Folder className="size-3 shrink-0 text-blue-300/45" />
          <span className="truncate">{node.name}</span>
        </Collapsible.Trigger>
        <Collapsible.Panel className="collapsible-panel overflow-hidden">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </Collapsible.Panel>
      </Collapsible.Root>
    );
  }
  if (!node.file) return null;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={cn(
        'flex h-7 w-full items-center gap-1.5 rounded-[5px] pr-2 text-left text-[9px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-400/50',
        selectedPath === node.path
          ? 'bg-blue-400/[0.09] text-blue-200/80'
          : 'text-zinc-550 hover:bg-white/[0.035] hover:text-zinc-300',
      )}
      style={{ paddingLeft: `${depth * 12 + 19}px` }}
    >
      <FileIcon file={node.file} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function FileIcon({ file }: { readonly file: CaptureFileRecord }) {
  if (file.preview === 'image') return <FileImage className="size-3 shrink-0 text-violet-300/55" />;
  if (file.preview === 'text') return <FileCode2 className="size-3 shrink-0 text-blue-300/50" />;
  return <File className="size-3 shrink-0 text-zinc-650" />;
}

function CodePreview({ preview }: { readonly preview: FilePreviewResult }) {
  const lines = preview.content.split('\n');
  const visibleLines = lines.slice(0, 5_000);
  return (
    <div className="h-full overflow-auto font-mono text-[10px] leading-[19px]">
      <div className="min-w-max py-2">
        {visibleLines.map((line, index) => (
          <div
            key={index}
            className="grid grid-cols-[52px_minmax(0,1fr)] px-2 hover:bg-white/[0.018]"
          >
            <span className="select-none border-r border-white/[0.045] pr-3 text-right tabular-nums text-zinc-750">
              {index + 1}
            </span>
            <code className="whitespace-pre px-4 text-zinc-400">
              {highlightLine(line, preview.language ?? getFileExtension(preview.relativePath))}
            </code>
          </div>
        ))}
      </div>
      {preview.truncated || lines.length > visibleLines.length ? (
        <div className="sticky bottom-0 border-t border-amber-400/10 bg-amber-400/[0.055] px-4 py-2 text-[9px] text-amber-300/70 backdrop-blur-md">
          Preview is truncated to protect renderer performance. The project file is unchanged.
        </div>
      ) : null}
    </div>
  );
}

function highlightLine(line: string, language: string): ReactNode {
  const normalized = language.toLowerCase();
  if (
    line.trimStart().startsWith('//') ||
    line.trimStart().startsWith('/*') ||
    line.trimStart().startsWith('*')
  ) {
    return <span className="text-zinc-650 italic">{line}</span>;
  }
  if (['json', 'jsonc'].includes(normalized)) return highlightJson(line);
  if (['html', 'htm', 'xml', 'svg'].includes(normalized)) return highlightMarkup(line);
  if (['css', 'scss', 'less'].includes(normalized)) return highlightCss(line);
  return line;
}

function highlightJson(line: string): ReactNode {
  const parts = line.split(
    /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?\b|\b(?:true|false|null)\b)/gu,
  );
  return parts.map((part, index) => {
    let className = '';
    if (/^".*"$/u.test(part))
      className = /:\s*$/u.test(line.slice(line.indexOf(part) + part.length))
        ? 'text-blue-300/80'
        : 'text-emerald-300/75';
    if (/^-?\d/u.test(part)) className = 'text-violet-300/80';
    if (/^(?:true|false|null)$/u.test(part)) className = 'text-amber-300/80';
    return (
      <span key={index} className={className}>
        {part}
      </span>
    );
  });
}

function highlightMarkup(line: string): ReactNode {
  const parts = line.split(/(<\/?[A-Za-z][^>]*>|<!--[\s\S]*?-->)/gu);
  return parts.map((part, index) => (
    <span
      key={index}
      className={
        part.startsWith('<!--')
          ? 'text-zinc-650 italic'
          : part.startsWith('<')
            ? 'text-blue-300/75'
            : ''
      }
    >
      {part}
    </span>
  ));
}

function highlightCss(line: string): ReactNode {
  const match = /^(\s*)([-A-Za-z0-9_]+)(\s*:)(.*)$/u.exec(line);
  if (!match) return line;
  return (
    <>
      {match[1]}
      <span className="text-blue-300/75">{match[2]}</span>
      <span className="text-zinc-600">{match[3]}</span>
      <span className="text-emerald-300/65">{match[4]}</span>
    </>
  );
}
