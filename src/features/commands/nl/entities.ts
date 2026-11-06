/**
 * Entity resolution for the command parser: "the workbench", "this cabinet", "the WRX", "the
 * garage door", "the north wall", "all cabinets". Deterministic word matching over names, labels,
 * definition names, template names and category synonyms, with the selection breaking ties.
 */
import { getScenario, resolveObject, roomGeometry } from '@/domain/resolve';
import type { EntityKind, EntityRef, Project } from '@/domain/schema';
import type { WallGeom } from '@/geometry';
import { stem, words } from './text';

export interface CatalogEntry {
  ref: EntityRef;
  name: string;
  /** Stemmed words that identify it. */
  words: Set<string>;
  /** Words from its own name/label (a name match beats a category synonym). */
  nameWords: Set<string>;
  kind: EntityKind;
}

/** Words that mean "every movable thing in the layout" ("move everything 6 inches north"). */
const EVERYTHING = new Set(['everything', 'anything', 'all', 'every', 'each', 'thing', 'things', 'item', 'items', 'object', 'objects', 'stuff']);

const SYNONYMS: Record<string, string[]> = {
  workbench: ['bench', 'work', 'table'],
  bench: ['workbench'],
  cabinet: ['cab'],
  vacuum: ['vac', 'shopvac'],
  miter: ['mitre', 'chop'],
  shelving: ['shelf', 'shelves', 'rack'],
  shelf: ['shelving'],
  cart: ['trolley'],
  saw: [],
  sedan: ['car', 'vehicle', 'auto'],
};

const CATEGORY_WORDS: Record<string, string[]> = {
  'work-surface': ['surface', 'bench'],
  'stationary-tool': ['tool', 'machine'],
  storage: ['storage'],
  misc: [],
  'dust-collection': ['dust'],
};

const FEATURE_WORDS: Record<string, string[]> = {
  'garage-door': ['garage', 'door', 'overhead'],
  door: ['door', 'entry'],
  'double-door': ['door', 'double'],
  window: ['window'],
  'support-pole': ['pole', 'post', 'column'],
  column: ['column', 'pole', 'post'],
  'water-heater': ['water', 'heater', 'tank'],
  'electrical-panel': ['panel'],
};

function addWords(set: Set<string>, text: string | undefined): void {
  if (!text) return;
  for (const w of words(text)) {
    set.add(w);
    for (const s of SYNONYMS[w] ?? []) set.add(stem(s));
  }
}

/** Every nameable entity in the active layout. */
export function buildCatalog(project: Project, scenarioId?: string): CatalogEntry[] {
  const s = getScenario(project, scenarioId);
  const out: CatalogEntry[] = [];
  for (const o of s.objects) {
    const r = resolveObject(project, o);
    const nameWords = new Set<string>();
    addWords(nameWords, o.name);
    addWords(nameWords, o.label);
    const all = new Set(nameWords);
    addWords(all, r.definition?.name);
    for (const t of r.definition?.tags ?? []) addWords(all, t);
    for (const c of CATEGORY_WORDS[r.category] ?? []) all.add(c);
    all.add('object');
    all.add('item');
    if (r.mobile) all.add('mobile');
    out.push({ ref: { kind: 'object', id: o.id }, name: o.label ?? o.name, words: all, nameWords, kind: 'object' });
  }
  for (const v of s.vehicles) {
    const nameWords = new Set<string>();
    addWords(nameWords, v.name);
    const all = new Set(nameWords);
    addWords(all, v.templateId?.replace(/-/g, ' '));
    for (const w of ['vehicle', 'car', 'auto', 'truck', 'suv']) all.add(w);
    out.push({ ref: { kind: 'vehicle', id: v.id }, name: v.name, words: all, nameWords, kind: 'vehicle' });
  }
  for (const f of project.architecture) {
    const nameWords = new Set<string>();
    addWords(nameWords, f.name);
    const all = new Set(nameWords);
    for (const w of FEATURE_WORDS[f.kind] ?? words(f.kind.replace(/-/g, ' '))) all.add(stem(w));
    out.push({ ref: { kind: 'feature', id: f.id }, name: f.name, words: all, nameWords, kind: 'feature' });
  }
  for (const z of s.zones) {
    const nameWords = new Set<string>();
    addWords(nameWords, z.name);
    const all = new Set(nameWords);
    all.add('zone');
    addWords(all, z.kind.replace(/-/g, ' '));
    out.push({ ref: { kind: 'zone', id: z.id }, name: z.name, words: all, nameWords, kind: 'zone' });
  }
  return out;
}

const STOP = new Set(['the', 'a', 'an', 'my', 'our', 'your', 'of', 'to', 'please', 'that', 'those', 'these', 'some', 'one', 'thing', 'them']);
const DEICTIC = new Set(['this', 'it', 'selected', 'selection', 'current', 'these', 'here']);

export type Resolution =
  | { status: 'ok'; refs: EntityRef[]; names: string[] }
  | { status: 'ambiguous'; mention: string; options: CatalogEntry[] }
  | { status: 'none'; mention: string }
  | { status: 'empty' };

export interface ResolveOptions {
  kinds?: EntityKind[];
  selection?: readonly EntityRef[];
  /** Allow multiple results ("all cabinets", plurals). */
  allowMany?: boolean;
}

/** Resolve a noun phrase to entities. */
export function resolveMention(mention: string, catalog: CatalogEntry[], opts: ResolveOptions = {}): Resolution {
  const raw = mention.toLowerCase().trim();
  const tokens = (raw.match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w));
  const deictic = tokens.some((t) => DEICTIC.has(t));
  const everything = tokens.some((t) => EVERYTHING.has(t)) && tokens.every((t) => EVERYTHING.has(t) || DEICTIC.has(t));
  const plural = /\b(all|every|everything|anything|each)\b/.test(raw) || tokens.some((t) => !DEICTIC.has(t) && !['this', 'its', 'is', 'was', 'has'].includes(t) && t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && stem(t) !== t);
  const content = tokens.filter((t) => !DEICTIC.has(t) && !EVERYTHING.has(t)).map(stem);
  const pool = catalog.filter((c) => !opts.kinds || opts.kinds.includes(c.kind));
  const selected = new Set((opts.selection ?? []).map((r) => `${r.kind}:${r.id}`));
  const isSel = (c: CatalogEntry) => selected.has(`${c.ref.kind}:${c.ref.id}`);

  // "everything" / "all items" → every nameable thing of the allowed kinds.
  if (everything && opts.allowMany !== false) {
    const movable = pool.filter((c) => c.kind === 'object' || c.kind === 'vehicle');
    const all = movable.length ? movable : pool;
    if (all.length) return { status: 'ok', refs: all.map((c) => c.ref), names: all.map((c) => c.name) };
  }
  if (content.length === 0) {
    if (deictic || tokens.length === 0) {
      const sel = pool.filter(isSel);
      if (sel.length) return { status: 'ok', refs: sel.map((c) => c.ref), names: sel.map((c) => c.name) };
      return { status: 'empty' };
    }
    return { status: 'none', mention };
  }

  // Score: every content word must match; name words weigh more than synonyms.
  const scored = pool
    .map((c) => {
      let score = 0;
      for (const w of content) {
        if (c.nameWords.has(w)) score += 3;
        else if (c.words.has(w)) score += 1;
        else return { c, score: -1 };
      }
      return { c, score: score - 0.01 * Math.max(0, c.nameWords.size - content.length) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { status: 'none', mention };
  if (deictic) {
    const sel = scored.filter((x) => isSel(x.c));
    if (sel.length) return { status: 'ok', refs: sel.map((x) => x.c.ref), names: sel.map((x) => x.c.name) };
  }
  if (plural && opts.allowMany) return { status: 'ok', refs: scored.map((x) => x.c.ref), names: scored.map((x) => x.c.name) };
  const top = scored[0]!.score;
  const best = scored.filter((x) => top - x.score < 0.5);
  if (best.length === 1) return { status: 'ok', refs: [best[0]!.c.ref], names: [best[0]!.c.name] };
  const sel = best.filter((x) => isSel(x.c));
  if (sel.length === 1) return { status: 'ok', refs: [sel[0]!.c.ref], names: [sel[0]!.c.name] };
  // Exact full-name match wins ("sedan" vs "sedan 2").
  const exact = best.filter((x) => x.c.nameWords.size === content.length);
  if (exact.length === 1) return { status: 'ok', refs: [exact[0]!.c.ref], names: [exact[0]!.c.name] };
  return { status: 'ambiguous', mention, options: best.map((x) => x.c) };
}

/** Walls matching "north wall", "the east wall", "garage door wall" (user names). */
export function resolveWalls(project: Project, text: string): WallGeom[] {
  const g = roomGeometry(project.room);
  const t = text.toLowerCase();
  // User or derived names first ("garage door wall", "north wall (west)").
  const byName = g.walls.filter((w) => t.includes(w.name.toLowerCase()));
  if (byName.length) return byName.sort((a, b) => b.name.length - a.name.length).slice(0, 1);
  const m = /\b(north|south|east|west)(?:ern)?\b/.exec(t);
  if (!m) return [];
  const dir = m[1]!;
  const exact = g.walls.filter((w) => w.compass === dir);
  if (exact.length) return exact;
  return g.walls.filter((w) => w.compass.includes(dir));
}
