import { sha256Hex } from './resources.js';

export interface DomNodeSnapshot {
  readonly tag: string;
  readonly role?: string | null;
  readonly text?: string | null;
  readonly id?: string | null;
  readonly classes?: readonly string[];
  readonly styles?: Readonly<Record<string, string | null | undefined>>;
  readonly children?: readonly DomNodeSnapshot[];
}

export interface DomOccurrence {
  readonly route: string;
  readonly domPath: string;
  readonly node: DomNodeSnapshot;
}

export interface DomSignatureOptions {
  readonly maxDepth?: number;
  readonly maxChildrenPerNode?: number;
}

export interface ComponentExample {
  readonly route: string;
  readonly domPath: string;
}

export interface ComponentCandidate {
  readonly suggestedName: string;
  readonly nameInferred: true;
  readonly confidence: number;
  readonly occurrences: number;
  readonly routes: readonly string[];
  readonly signature: string;
  readonly styleSummary: Readonly<Record<string, string>>;
  readonly examples: readonly ComponentExample[];
}

export interface ComponentAggregationOptions extends DomSignatureOptions {
  readonly minimumOccurrences?: number;
  readonly maximumExamples?: number;
}

interface NormalizedNode {
  readonly tag: string;
  readonly role: string;
  readonly classes: readonly string[];
  readonly hasText: boolean;
  readonly styles: readonly (readonly [string, string])[];
  readonly children: readonly NormalizedNode[];
  readonly childrenTruncated: boolean;
}

interface InferredName {
  readonly name: string;
  readonly strength: number;
}

const SIGNATURE_STYLE_PROPERTIES = [
  'display',
  'position',
  'flex-direction',
  'grid-template-columns',
  'align-items',
  'justify-content',
  'border-radius',
  'font-weight',
] as const;

const SUMMARY_STYLE_PROPERTIES = [
  'display',
  'gap',
  'padding',
  'background-color',
  'border',
  'border-radius',
  'box-shadow',
] as const;

const STYLE_ALIASES: Readonly<Record<string, string>> = {
  'flex-direction': 'flexDirection',
  'grid-template-columns': 'gridTemplateColumns',
  'align-items': 'alignItems',
  'justify-content': 'justifyContent',
  'background-color': 'backgroundColor',
  'border-radius': 'borderRadius',
  'font-weight': 'fontWeight',
  'box-shadow': 'boxShadow',
};

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function styleValue(node: DomNodeSnapshot, property: string): string | undefined {
  const direct = node.styles?.[property];
  const alias = STYLE_ALIASES[property];
  const raw = direct ?? (alias === undefined ? undefined : node.styles?.[alias]);
  const normalized = raw?.replace(/\s+/g, ' ').trim();
  return normalized === '' ? undefined : normalized;
}

function isGeneratedClassName(className: string): boolean {
  return (
    /^(?:css|jsx|sc)-[a-z\d_-]{6,}$/i.test(className) ||
    /^_[a-f\d]{6,}$/i.test(className) ||
    /^[a-f\d]{10,}$/i.test(className)
  );
}

function normalizedClasses(node: DomNodeSnapshot): string[] {
  return [
    ...new Set(
      (node.classes ?? [])
        .map((className) => className.trim().toLowerCase())
        .filter((className) => className !== '' && !isGeneratedClassName(className)),
    ),
  ].sort();
}

function normalizeNode(
  node: DomNodeSnapshot,
  depth: number,
  maximumDepth: number,
  maximumChildren: number,
): NormalizedNode {
  const children = node.children ?? [];
  const normalizedChildren =
    depth >= maximumDepth
      ? []
      : children
          .slice(0, maximumChildren)
          .map((child) => normalizeNode(child, depth + 1, maximumDepth, maximumChildren));
  const styles = SIGNATURE_STYLE_PROPERTIES.flatMap((property): (readonly [string, string])[] => {
    const value = styleValue(node, property);
    return value === undefined ? [] : [[property, value]];
  });

  return {
    tag: node.tag.trim().toLowerCase() || 'unknown',
    role: node.role?.trim().toLowerCase() ?? '',
    classes: normalizedClasses(node),
    hasText: (node.text?.trim().length ?? 0) > 0,
    styles,
    children: normalizedChildren,
    childrenTruncated:
      depth >= maximumDepth ? children.length > 0 : children.length > maximumChildren,
  };
}

/** Hashes stable visual/semantic structure, intentionally excluding text and element IDs. */
export function createDomSignature(
  node: DomNodeSnapshot,
  options: DomSignatureOptions = {},
): string {
  const maximumDepth = options.maxDepth ?? 5;
  const maximumChildren = options.maxChildrenPerNode ?? 20;
  requirePositiveInteger(maximumDepth, 'maxDepth');
  requirePositiveInteger(maximumChildren, 'maxChildrenPerNode');
  return sha256Hex(JSON.stringify(normalizeNode(node, 0, maximumDepth, maximumChildren)));
}

function inferenceCorpus(node: DomNodeSnapshot): string {
  return [node.tag, node.role ?? '', ...(node.classes ?? []), node.text?.slice(0, 160) ?? '']
    .join(' ')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
}

function inferComponentName(node: DomNodeSnapshot): InferredName {
  const tag = node.tag.trim().toLowerCase();
  const role = node.role?.trim().toLowerCase() ?? '';
  const corpus = inferenceCorpus(node);

  if (tag === 'nav' || role === 'navigation') return { name: 'Navbar', strength: 0.15 };
  if (tag === 'footer' || /\bfooter\b/.test(corpus)) return { name: 'Footer', strength: 0.15 };
  if (/\bpricing\b.*\bcard\b|\bcard\b.*\bpricing\b/.test(corpus)) {
    return { name: 'PricingCard', strength: 0.18 };
  }
  if (/\btestimonial\b/.test(corpus)) return { name: 'TestimonialCard', strength: 0.18 };
  if (/\bfeature\b.*\bcard\b|\bcard\b.*\bfeature\b/.test(corpus)) {
    return { name: 'FeatureCard', strength: 0.18 };
  }
  if (/\blogo\b.*\bcloud\b|\bcloud\b.*\blogo\b/.test(corpus))
    return { name: 'LogoCloud', strength: 0.18 };
  if (/\bcta\b|\bcall to action\b/.test(corpus)) return { name: 'CTA', strength: 0.17 };
  if (/\bsidebar\b.*\bitem\b|\bitem\b.*\bsidebar\b/.test(corpus)) {
    return { name: 'SidebarItem', strength: 0.17 };
  }
  if (/\bsection\b.*\bheader\b|\bheader\b.*\bsection\b/.test(corpus)) {
    return { name: 'SectionHeader', strength: 0.17 };
  }
  if (tag === 'header') return { name: 'Header', strength: 0.14 };
  if (tag === 'button' || role === 'button') return { name: 'Button', strength: 0.14 };
  if (/\bnavigation\b.*\blink\b|\bnav\b.*\blink\b/.test(corpus)) {
    return { name: 'NavigationLink', strength: 0.16 };
  }
  if (/\bcard\b/.test(corpus)) return { name: 'Card', strength: 0.13 };
  if (tag === 'a' || role === 'link') return { name: 'Link', strength: 0.1 };
  return { name: `${toPascalCase(tag)}Component`, strength: 0.05 };
}

function toPascalCase(value: string): string {
  const parts = value.split(/[^a-zA-Z0-9]+/).filter((part) => part !== '');
  if (parts.length === 0) return 'Unknown';
  return parts
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`)
    .join('');
}

function summarizeStyles(occurrences: readonly DomOccurrence[]): Readonly<Record<string, string>> {
  const summary: Record<string, string> = {};
  for (const property of SUMMARY_STYLE_PROPERTIES) {
    const frequencies = new Map<string, number>();
    for (const occurrence of occurrences) {
      const value = styleValue(occurrence.node, property);
      if (value !== undefined) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
    }

    const winner = [...frequencies.entries()].sort(
      ([leftValue, leftCount], [rightValue, rightCount]) =>
        rightCount - leftCount || leftValue.localeCompare(rightValue),
    )[0];
    if (winner !== undefined) summary[property] = winner[0];
  }
  return summary;
}

function candidateConfidence(
  occurrences: readonly DomOccurrence[],
  inferredName: InferredName,
): number {
  const occurrenceSignal = Math.min(0.18, Math.max(0, occurrences.length - 2) * 0.04);
  const routeSignal =
    new Set(occurrences.map((occurrence) => occurrence.route)).size > 1 ? 0.06 : 0;
  return Number(
    Math.min(0.98, 0.55 + occurrenceSignal + routeSignal + inferredName.strength).toFixed(2),
  );
}

/** Aggregates recurring subtree signatures without using an external model. */
export function aggregateComponentCandidates(
  occurrences: readonly DomOccurrence[],
  options: ComponentAggregationOptions = {},
): ComponentCandidate[] {
  const minimumOccurrences = options.minimumOccurrences ?? 2;
  const maximumExamples = options.maximumExamples ?? 3;
  requirePositiveInteger(minimumOccurrences, 'minimumOccurrences');
  requirePositiveInteger(maximumExamples, 'maximumExamples');

  const groups = new Map<string, DomOccurrence[]>();
  for (const occurrence of occurrences) {
    const signature = createDomSignature(occurrence.node, options);
    const group = groups.get(signature);
    if (group === undefined) groups.set(signature, [occurrence]);
    else group.push(occurrence);
  }

  const candidates: ComponentCandidate[] = [];
  for (const [signature, group] of groups) {
    if (group.length < minimumOccurrences) continue;
    const sortedGroup = [...group].sort(
      (left, right) =>
        left.route.localeCompare(right.route) || left.domPath.localeCompare(right.domPath),
    );
    const representative = sortedGroup[0];
    if (representative === undefined) continue;
    const inferredName = inferComponentName(representative.node);

    candidates.push({
      suggestedName: inferredName.name,
      nameInferred: true,
      confidence: candidateConfidence(sortedGroup, inferredName),
      occurrences: sortedGroup.length,
      routes: [...new Set(sortedGroup.map((occurrence) => occurrence.route))].sort(),
      signature,
      styleSummary: summarizeStyles(sortedGroup),
      examples: sortedGroup
        .slice(0, maximumExamples)
        .map(({ route, domPath }) => ({ route, domPath })),
    });
  }

  return candidates.sort(
    (left, right) =>
      right.occurrences - left.occurrences ||
      left.suggestedName.localeCompare(right.suggestedName) ||
      left.signature.localeCompare(right.signature),
  );
}
