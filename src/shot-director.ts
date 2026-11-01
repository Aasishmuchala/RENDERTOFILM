/**
 * The shot director: one clip, directed from what its first frame shows. A
 * vision text call (src/shot-director-api.ts) reads the photograph and
 * answers a plan: an inventory of what is really there, a camera move
 * described against those elements, what moves (only what moves in life),
 * what the people already there do, timing beats, focus and the last frame.
 *
 * The plan is checked in code, not trusted: `resolveShotPlan` removes a
 * person the image does not show, drops a moving element the inventory
 * lacks or that never moves in life, takes out every clause of the planner's
 * wording that names something a failed reference named (or a person where
 * there is none, or something coming in), and holds the camera grammar.
 * `FREE_MOVES` are always allowed; `REVEAL_MOVES` only when the clip can end
 * on a crop of the same photograph (`cropRects`; the server cuts and uploads
 * both crops, so the first and last frames are pieces of the one image);
 * `NEVER_MOVES` (arcs) show what is behind things and always downgrade. With
 * the user's own last or middle frames every move is allowed and no crops
 * are cut: the frames win, as without the director.
 *
 * `buildDirectedVideoPrompt` writes the clip's prompt from the resolved shot
 * and fits it under 3400 characters, so `clampPrompt(…, 3500)` never cuts it.
 * `buildVideoPrompt` (src/models.ts) is not touched: with the director off
 * every prompt is what it was (.router/video-prompt.ts). Recreate in 4K takes
 * only `inventoryLock`, since its reference clip sets the camera.
 *
 * Pure: imports only models, direction and recreate (no zod, no I/O), so the
 * client resolves a plan for its editor with the code the server runs.
 * .router/shot-director.ts holds the vectors.
 */
import { lensBlock, SHOT_CRAFT } from './direction.ts';
import {
  frameSentences,
  MOTION_IDS,
  MOTIONS,
  MOVE_STYLES,
  type MotionId,
  type MoveStyleId,
  SPEEDS,
  type SpeedId,
  STRICT_SENTENCE,
  videoKeyframeLimit,
  type VideoModelId,
  videoModelName,
} from './models.ts';
import { buildRecreatePrompt } from './recreate.ts';

/** The planner's model: the same as the close-up finder and both planners. */
export const SHOT_DIRECTOR_MODEL = 'claude-sonnet-5-5';

/** A crop is this share of each side of the image, so it keeps the image's aspect. */
export const CROP_SCALE = 0.7;

/** Below this many pixels on the crop's shorter side a reveal move downgrades instead. */
export const MIN_CROP_SIDE = 540;

/** Moves that never show more than the photograph: always allowed. */
export const FREE_MOVES: readonly MotionId[] = ['still-life', 'push-in', 'focus-pull', 'drift-left', 'drift-right'];

/** Moves that would reveal space past an edge: allowed only between two crops of the image. */
export const REVEAL_MOVES: readonly MotionId[] = ['pull-out', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'crane-up', 'crane-down'];

/** Moves that show what is behind things: never, unless the user's own frames lead there. */
export const NEVER_MOVES: readonly MotionId[] = ['arc-left', 'arc-right'];

/** The free move each move becomes when it is not allowed; a free move stays itself. */
export const DOWNGRADE: Record<MotionId, MotionId> = {
  'still-life': 'still-life',
  'push-in': 'push-in',
  'focus-pull': 'focus-pull',
  'drift-left': 'drift-left',
  'drift-right': 'drift-right',
  'pull-out': 'still-life',
  'pan-left': 'drift-left',
  'pan-right': 'drift-right',
  'tilt-up': 'still-life',
  'tilt-down': 'still-life',
  'crane-up': 'still-life',
  'crane-down': 'still-life',
  'arc-left': 'drift-left',
  'arc-right': 'drift-right',
};

export type InventoryKind = 'water' | 'vegetation' | 'people' | 'fabric' | 'light' | 'structure' | 'object' | 'sky' | 'ground';

const INVENTORY_KINDS: readonly string[] = ['water', 'vegetation', 'people', 'fabric', 'light', 'structure', 'object', 'sky', 'ground'];

/** One element the photograph really shows; `moves` only for what moves in life. */
export type InventoryItem = { id: string; name: string; where: string; kind: InventoryKind; moves: boolean };

/** The planner's answer after the server's schema check; what the client edits and sends back. */
export type ShotPlanRaw = {
  inventory: InventoryItem[];
  people: { present: boolean; count: number; action: string };
  camera: { move: string; from: string; to: string; why: string };
  moving: { id: string; how: string }[];
  beats: { at: number; what: string }[];
  focus: { start: string; end: string } | null;
  end: string;
  rationale: string;
};

/**
 * What `resolveShotPlan` reads: a `ShotPlanRaw`, or the server schema's
 * output, whose inventory `kind` is any string until it is resolved here.
 */
type ShotPlanLoose = Omit<ShotPlanRaw, 'inventory'> & {
  inventory: (Omit<InventoryItem, 'kind'> & { kind: string })[];
};

export type ShotContext = {
  videoModel: VideoModelId;
  width: number;
  height: number;
  /** Whether people may be in the frame (still.crowd !== 'none'; true for an upload). */
  people: boolean;
  /** The user supplied a last or middle frame: every move allowed, no crops. */
  userKeyframes: boolean;
  /** videoKeyframeLimit(model) >= 2 && !(refs > 0 && videoExtrasExcludeEnd(model)). */
  canEndFrame: boolean;
};

/** Integers, inside the image. */
export type Rect = { x: number; y: number; width: number; height: number };

export type ResolvedShot = {
  inventory: InventoryItem[];
  people: { present: boolean; action: string };
  camera: {
    move: MotionId;
    downgradedFrom?: MotionId | undefined;
    from?: InventoryItem | undefined;
    to?: InventoryItem | undefined;
    why: string;
    /** Only on a REVEAL move allowed through crops. `start` undefined = opens on the whole image; `end` undefined = ends on the whole image. */
    crops?: { start?: Rect | undefined; end?: Rect | undefined } | undefined;
  };
  moving: { item: InventoryItem; how: string }[];
  beats: { at: number; what: string }[];
  focus?: { start: InventoryItem; end: InventoryItem } | undefined;
  end: string;
  rationale: string;
  /** What validation changed, in the user's words, e.g. "Removed a person the image does not show." */
  notes: string[];
};

/** The JSON object in the planner's answer (first `{` to last `}`), or null. The server applies the schema. */
export function parseShotPlan(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/**
 * The first and last frames of a reveal move, both crops of the image at
 * `CROP_SCALE` of each side: a pan travels left centre to right centre (or
 * back), a tilt or crane bottom centre to top centre (or back), and a pull
 * out opens on the centre and ends on the whole image (`end` absent). Null
 * for any other move, or when the crop's shorter side is under
 * `MIN_CROP_SIDE`.
 */
export function cropRects(move: MotionId, width: number, height: number): { start?: Rect; end?: Rect } | null {
  if (!REVEAL_MOVES.includes(move)) return null;
  const W = Math.round(width);
  const H = Math.round(height);
  const w = Math.round(CROP_SCALE * W);
  const h = Math.round(CROP_SCALE * H);
  if (!(Math.min(w, h) >= MIN_CROP_SIDE)) return null;
  const cx = Math.round((W - w) / 2);
  const cy = Math.round((H - h) / 2);
  const at = (x: number, y: number): Rect => ({ x, y, width: w, height: h });
  const left = at(0, cy);
  const right = at(W - w, cy);
  const top = at(cx, 0);
  const bottom = at(cx, H - h);
  switch (move) {
    case 'pan-right':
      return { start: left, end: right };
    case 'pan-left':
      return { start: right, end: left };
    case 'tilt-up':
    case 'crane-up':
      return { start: bottom, end: top };
    case 'tilt-down':
    case 'crane-down':
      return { start: top, end: bottom };
    default:
      return { start: at(cx, cy) };
  }
}

/** The moves the plan may name before the image's size is known. */
function grammarMoves(canEndFrame: boolean, userKeyframes: boolean): MotionId[] {
  if (userKeyframes) return [...MOTION_IDS];
  return MOTION_IDS.filter((m) => FREE_MOVES.includes(m) || (canEndFrame && REVEAL_MOVES.includes(m)));
}

/** The moves the editor's camera Select offers here, in `MOTIONS` order: free, reveal when crops would be cut, all with the user's own frames. */
export function allowedMoves(ctx: ShotContext): MotionId[] {
  return grammarMoves(
    ctx.canEndFrame && cropRects('pan-right', ctx.width, ctx.height) !== null,
    ctx.userKeyframes
  );
}

function motionName(id: MotionId): string {
  return (MOTIONS.find((m) => m.id === id) ?? MOTIONS[0]).name;
}

const DANGLING = /\s+(?:a|an|and|at|beside|by|for|from|in|into|of|on|or|the|to|toward|with)$/i;

/** Cut at a word to at most `max` characters, without a dangling comma, colon or "and". */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  let out = (space >= max / 2 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,;:]+$/, '');
  while (DANGLING.test(out)) out = out.replace(DANGLING, '').replace(/[\s,;:]+$/, '');
  return out;
}

/** Planner text: a string, on one line, trimmed and cut to `max`. */
function text(value: unknown, max: number): string {
  return typeof value === 'string' ? clip(value.replace(/\s+/g, ' ').trim(), max) : '';
}

/** Without a closing full stop, for text a sentence ends itself. */
function bare(s: string): string {
  return s.replace(/[\s.;,:]+$/, '');
}

/** A planner sentence set inside one of ours: "at 3 s the camera settles", not "at 3 s The camera settles". */
function midSentence(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/** The planner's end, as the object of "The shot ends on": its own lead-in ("The last frame rests on") goes. */
function endObject(s: string): string {
  return midSentence(s.replace(/^(the )?(last|final|closing) frame (rests|lands|settles|holds|ends|stays) on\s+/i, '').replace(/^(the )?(shot|clip|camera) (ends|settles|lands|rests|holds) on\s+/i, ''));
}

const INVENTORY_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** A people action that brings someone into the frame rather than moving who is there. */
const BRINGS_SOMEONE_IN =
  /\b(?:enters|enter|arrives|arrive|walks in|comes in|appears|appear|joins|join|a new|another person|someone else)\b/i;

/** What the lock names when the plan names nothing usable. */
const WHOLE_SCENE: InventoryItem = { id: 'scene', name: 'the scene as photographed', where: 'whole frame', kind: 'structure', moves: false };

/** Words for people and animals: a clause naming one is dropped when the frame has none. */
const PEOPLE_WORDS = [
  'person', 'people', 'man', 'men', 'woman', 'women', 'couple', 'family', 'child', 'children', 'kid', 'kids', 'boy',
  'girl', 'resident', 'residents', 'visitor', 'walker', 'jogger', 'crowd', 'guest', 'figure', 'someone', 'pedestrian',
  'mother', 'father', 'son', 'daughter', 'dog', 'cat', 'bird', 'animal',
];

/** Words in a failed reference that name no thing: articles, places in the frame, the film's own vocabulary. */
const STOPWORDS = new Set([
  'the', 'and', 'with', 'from', 'into', 'onto', 'over', 'under', 'near', 'behind', 'beside', 'toward', 'towards', 'its',
  'his', 'her', 'their', 'this', 'that', 'these', 'those', 'for', 'are', 'was', 'were', 'has', 'have', 'all', 'any',
  'out', 'off', 'one', 'two', 'three', 'left', 'right', 'top', 'bottom', 'centre', 'center', 'middle', 'front', 'back',
  'side', 'edge', 'far', 'upper', 'lower', 'foreground', 'background', 'main', 'big', 'small', 'large', 'tall', 'low',
  'high', 'long', 'short', 'old', 'new', 'open', 'closed', 'shot', 'camera', 'frame', 'view', 'scene', 'image',
  'photograph', 'picture', 'light', 'focus', 'clip', 'end', 'start', 'first', 'last', 'area', 'part', 'element', 'thing',
  'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white', 'black', 'grey', 'gray', 'brown', 'gold',
  'golden', 'silver', 'dark', 'pale', 'bright',
]);

/** Something coming into the picture, or the camera showing what it does not. */
const ENTRY =
  /\b(?:enters|enter|walks in|walk in|comes in|comes into|appears|arrives|emerges|flies in|drives in|reveals|revealing)\b/i;

/** Where planner text splits into clauses; the separators are kept for the rejoin. */
const CLAUSE_BREAK = /(\s*[.;,]\s*|\s+and\s+)/i;

function wordsOf(s: string): string[] {
  return s.toLowerCase().match(/[a-z]+/g) ?? [];
}

/** A word and its plain plural or singular. */
function wordForms(w: string): string[] {
  return [w, `${w}s`, `${w}es`, ...(w.length > 3 && w.endsWith('s') ? [w.slice(0, -1)] : [])];
}

const PEOPLE_FORMS = new Set(PEOPLE_WORDS.flatMap(wordForms));

/** The lexicon's words that can only mean a person (no figure, no animal). */
const HUMAN_FORMS = new Set(
  PEOPLE_WORDS.filter((w) => !['figure', 'dog', 'cat', 'bird', 'animal'].includes(w)).flatMap(wordForms)
);

/** An image of a person is not a person. */
const ARTWORK =
  /\b(?:statues?|sculptures?|busts?|reliefs?|carvings?|paintings?|artworks?|murals?|posters?|portraits?|mannequins?|figurines?|photos?|photographs?)\b/i;

/**
 * Whether an item the planner tagged as a thing names someone (a word in
 * `forms`) in its name or id. Only `object` and `fabric` are read: a person
 * is never tagged a plant, a building or the sky, and those kinds carry
 * names like "the guest house", "the man-made lake" or "mother-in-law's
 * tongue". Artworks and possessives ("a child's swing") are things.
 */
function namesSomeone(kind: InventoryKind, name: string, id: string, forms: Set<string>): boolean {
  if ((kind !== 'object' && kind !== 'fabric') || ARTWORK.test(name)) return false;
  return wordsOf(`${name.replace(/\b[a-z]+['\u2019]s?\b/gi, ' ')} ${id}`).some((w) => forms.has(w));
}

/** Why a clause must go (it names a rejected word or something coming in), or null. */
function invention(clause: string, rejected: Map<string, string>): string | null {
  const lower = clause.toLowerCase();
  const entry = ENTRY.exec(lower);
  for (const m of lower.matchAll(/[a-z]+/g)) {
    if (entry && entry.index < (m.index ?? 0)) break;
    if (rejected.has(m[0])) return `Dropped mention of ${m[0]}: it is not in the picture.`;
  }
  return entry ? `Dropped "${entry[0]}": nothing new may come into the picture.` : null;
}

/**
 * Planner text with every clause that names something outside the picture
 * taken out (split on . ; , and "and", rejoined with the separators that
 * were there). Unchanged, character for character, when nothing goes.
 */
function scrub(value: string, rejected: Map<string, string>, notes: Set<string>): string {
  if (!value) return value;
  const parts = value.split(CLAUSE_BREAK);
  let out = '';
  let dropped = false;
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i] ?? '';
    if (!clause.trim()) continue;
    const reason = invention(clause, rejected);
    if (reason) {
      notes.add(reason);
      dropped = true;
      continue;
    }
    out += (out ? (parts[i - 1] ?? ' ') : '') + clause;
  }
  if (!dropped) return value;
  out = out.trim();
  return out && /\.\s*$/.test(value) ? `${out}.` : out;
}

/**
 * The plan, checked against what the clip can do. In order: the inventory
 * (valid unique ids, at most 24, no people where the image has none), the
 * people's one action (never someone arriving), the camera (a known move,
 * targets in the inventory, the grammar), what moves (only inventory items
 * that move in life, at most 6), focus, then the planner's free text: every
 * clause that names something a failed reference named (or a person or an
 * animal, when the frame has none), or that has something come into the
 * picture, is taken out, so no invention reaches the prompt or the editor
 * through the wording. Last the beats (2 to 5, in order). Every change it
 * makes adds one note.
 */
export function resolveShotPlan(raw: ShotPlanLoose, ctx: ShotContext): ResolvedShot {
  const notes: string[] = [];
  /** Ids the plan pointed at that are not in the inventory. */
  const failed: string[] = [];

  // 1. Inventory.
  const seen = new Set<string>();
  let inventory: InventoryItem[] = [];
  let removedPeople = 0;
  for (const item of raw.inventory ?? []) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!INVENTORY_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    let kind: InventoryKind = INVENTORY_KINDS.includes(item.kind) ? (item.kind as InventoryKind) : 'object';
    const name = text(item.name, 80) || id.replace(/-/g, ' ');
    // A person tagged as a thing is still a person: removed where the frame
    // has none (their words scrubbed everywhere), counted as people where it has.
    if (!ctx.people && (kind === 'people' || namesSomeone(kind, name, id, PEOPLE_FORMS))) {
      removedPeople += 1;
      failed.push(id, name);
      continue;
    }
    if (ctx.people && namesSomeone(kind, name, id, HUMAN_FORMS)) kind = 'people';
    if (inventory.length === 24) continue;
    inventory.push({ id, name, where: text(item.where, 60), kind, moves: item.moves === true });
  }
  if (removedPeople) {
    notes.push(
      removedPeople === 1
        ? 'Removed a person the image does not show.'
        : `Removed ${removedPeople} people the image does not show.`
    );
  }
  if (!inventory.length) inventory = [{ ...WHOLE_SCENE }];
  const byId = new Map(inventory.map((i) => [i.id, i]));

  // 2. People: only those already in the frame, and nobody brought in.
  const present = inventory.some((i) => i.kind === 'people');
  let action = present ? text(raw.people?.action, 400) : '';
  if (action && BRINGS_SOMEONE_IN.test(action)) {
    action = '';
    notes.push('Dropped a people action that brings someone in; only the people already in the frame may move.');
  }

  // 3. Camera: a known move, targets that exist, then the grammar.
  const asked = typeof raw.camera?.move === 'string' ? raw.camera.move : '';
  let move: MotionId = 'still-life';
  if ((MOTION_IDS as readonly string[]).includes(asked)) move = asked as MotionId;
  else notes.push('The director named a camera move the app does not know; changed to Locked off.');
  const fromId = text(raw.camera?.from, 32);
  const toId = text(raw.camera?.to, 32);
  const from = fromId ? byId.get(fromId) : undefined;
  const to = toId ? byId.get(toId) : undefined;
  if (fromId && !from) failed.push(fromId);
  if (toId && !to) failed.push(toId);
  if ((fromId && !from) || (toId && !to)) {
    notes.push('The camera was aimed at something that is not in the picture; that target was dropped.');
  }
  let downgradedFrom: MotionId | undefined;
  let crops: { start?: Rect; end?: Rect } | undefined;
  if (!ctx.userKeyframes && REVEAL_MOVES.includes(move)) {
    const rects = ctx.canEndFrame ? cropRects(move, ctx.width, ctx.height) : null;
    if (rects) {
      crops = rects;
    } else {
      downgradedFrom = move;
      move = DOWNGRADE[move];
      const reason = ctx.canEndFrame
        ? ', and the image is too small to end on a crop of it'
        : videoKeyframeLimit(ctx.videoModel) >= 2
          ? ' while extra images are attached'
          : ` on ${videoModelName(ctx.videoModel)}`;
      notes.push(`${motionName(downgradedFrom)} would reveal space outside the image${reason}; changed to ${motionName(move)}.`);
    }
  } else if (!ctx.userKeyframes && NEVER_MOVES.includes(move)) {
    downgradedFrom = move;
    move = DOWNGRADE[move];
    notes.push(`An arc would show what is behind things; changed to ${motionName(move)}.`);
  }

  // 4. What moves: inventory items that move in life, at most 6.
  const moving: { item: InventoryItem; how: string }[] = [];
  const named = new Set<string>();
  for (const m of raw.moving ?? []) {
    const id = text(m?.id, 32);
    if (!id || named.has(id)) continue;
    named.add(id);
    const item = byId.get(id);
    if (!item) {
      failed.push(id);
      notes.push(`Dropped ${id}: it is not in the picture.`);
    } else if (!item.moves) notes.push(`Only things that move in life can move: dropped ${id}.`);
    else if (moving.length < 6) moving.push({ item, how: text(m.how, 200) });
  }

  // 5. Focus: both ends in the inventory.
  const focusStartId = text(raw.focus?.start, 32);
  const focusEndId = text(raw.focus?.end, 32);
  const focusStart = byId.get(focusStartId);
  const focusEnd = byId.get(focusEndId);
  if (focusStartId && !focusStart) failed.push(focusStartId);
  if (focusEndId && !focusEnd) failed.push(focusEndId);

  // 6. The free text: nothing a failed reference named, no people or animals
  // where there are none, nothing coming in. A word any inventory item's name
  // or id uses is never rejected.
  const known = new Set(inventory.flatMap((i) => wordsOf(`${i.name} ${i.id}`)));
  const rejected = new Map<string, string>();
  const candidates = [
    ...failed.flatMap((id) => wordsOf(id).filter((w) => w.length >= 3 && !STOPWORDS.has(w))),
    ...(present ? [] : PEOPLE_WORDS),
  ];
  for (const w of candidates) {
    const forms = wordForms(w);
    if (forms.some((f) => known.has(f))) continue;
    for (const f of forms) rejected.set(f, w);
  }
  const scrubbed = new Set<string>();
  const clean = (value: string) => (rejected.size || ENTRY.test(value) ? scrub(value, rejected, scrubbed) : value);
  action = clean(action);
  const why = clean(text(raw.camera?.why, 300));
  for (const m of moving) m.how = clean(m.how);
  const rawEnd = text(raw.end, 300);
  let end = clean(rawEnd);
  // An end that named only what is not there becomes the end the structure
  // gives: the camera's target, or the opening framing for a camera that
  // does not travel. A moving camera with no target gets no end sentence,
  // since "the same framing" would contradict its move.
  if (rawEnd && !end) {
    end = to
      ? /^(?:the|a|an)\s/i.test(to.name)
        ? to.name
        : `the ${to.name}`
      : move === 'still-life' || move === 'focus-pull'
        ? 'the same framing it opened on'
        : '';
  }

  // 7. Beats: 2 to 5 moments in the clip, in order; a beat left empty goes.
  let beats = (raw.beats ?? [])
    .filter((b) => typeof b?.at === 'number' && Number.isFinite(b.at) && b.at >= 0 && b.at <= 1)
    .map((b) => ({ at: b.at, what: clean(text(b.what, 200)) }))
    .filter((b) => b.what)
    .sort((a, b) => a.at - b.at)
    .slice(0, 5);
  if (beats.length < 2) {
    beats = [
      { at: 0, what: 'the shot opens exactly on the photograph' },
      { at: 1, what: end || 'the shot settles and holds' },
    ];
  }
  const rationale = clean(text(raw.rationale, 300));
  notes.push(...scrubbed);

  return {
    inventory,
    people: { present, action },
    camera: {
      move,
      ...(downgradedFrom ? { downgradedFrom } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      why,
      ...(crops ? { crops } : {}),
    },
    moving,
    beats,
    ...(focusStart && focusEnd ? { focus: { start: focusStart, end: focusEnd } } : {}),
    end,
    rationale,
    notes,
  };
}

/**
 * A person's unseen side is not in the photograph either: someone seen from
 * behind who turns to the camera shows a face the image never did (the
 * 2026-10-30 real run on Kling 3.0 Pro did exactly that). Every directed
 * people sentence carries it, before the action.
 */
export const PEOPLE_FACING_SENTENCE =
  'The people already in the frame stay exactly the same people, with the same faces, hair, clothing and real-world scale, each facing as in the photograph: anyone seen from behind or in profile never turns toward the camera, so no unseen face appears.';

/** The directed people sentence: the video check's two needles, and the director's one action. */
function directedPeopleSentence(action: string): string {
  return [
    PEOPLE_FACING_SENTENCE,
    action ? `Their one action: ${action}.` : 'Each makes one small, natural movement at real-time speed.',
    'Lips stay closed: no talking, no mouth movement, no visible breath. Faces never morph; eyes blink naturally, never into the lens. Feet stay planted on the ground with matching shadows, never sliding; hands keep five natural fingers; no one appears, disappears or changes size.',
  ].join(' ');
}

const ARCHVIZ_DIRECTED_SENTENCE =
  'Shot as a high-end architectural film: a level horizon, truly vertical verticals, no roll, keystone or lens distortion, one motion-control-smooth move with no zoom or shake, crisp true material detail in stone, timber, glass, metal and planting.';

const LOCK_REST =
  'Everything that does not move in real life stays exactly as it is in the photograph, rigid and unchanged in shape, number and position, with nothing added or removed.';

/** "Only these exist…": the `names` shown, and how many more of the `total` there are. */
function existSentence(names: string[], total: number): string {
  const more = total - names.length;
  return `Only these exist in the scene, and nothing else: ${names.join('; ')}${
    more ? `; and ${more} more fixed elements already visible` : ''
  }.`;
}

/**
 * "Only these move…", or that nothing does. People who are there always
 * make their one action, so when the list leaves them out they are named
 * last, and the sentence never tells them to freeze.
 */
function movesSentence(moving: { item: InventoryItem }[], parts: string[], present: boolean): string {
  const people = present && !moving.some((m) => m.item.kind === 'people');
  if (parts.length) {
    return `Only these move, and only as they do in life: ${parts.join('; ')}${people ? '; and the people already in the frame' : ''}.`;
  }
  return people
    ? 'Nothing in the scene moves except the people; the light stays the same throughout.'
    : 'Nothing in the scene moves; the light stays the same throughout.';
}

/** `n` of the beats, spread over the clip: the first, the last and the middle ones between. */
function pickBeats<T>(beats: T[], n: number): T[] {
  if (beats.length <= n) return beats;
  if (n <= 0) return [];
  if (n === 1) return [beats[beats.length - 1]!];
  return Array.from({ length: n }, (_, i) => beats[Math.round((i * (beats.length - 1)) / (n - 1))]!);
}

type DirectedOptions = {
  seconds: number;
  direction: string;
  style: MoveStyleId;
  speed: SpeedId;
  frames?: { last?: boolean; middle?: number; refs?: number } | undefined;
  archviz: boolean;
};

/** How much of the plan the prompt carries: counts, and the longest each kind of text may run. */
type Fit = {
  archviz: boolean;
  beats: number;
  moving: number;
  names: number;
  name: number;
  how: number;
  what: number;
  action: number;
  end: number;
  focus: boolean;
};

/** The directed prompt's ceiling: under Seedance's 3500 with room to spare. */
const DIRECTED_BUDGET = 3400;

/**
 * What gives way, in order, while the prompt is over budget. The plan's
 * order first (the architectural sentence, then beats, moving items and
 * named elements); then the planner's own wording shortens and the extras
 * go, so even the longest plan with the longest direction and every frame
 * sentence fits. The rules (the lock, the people needles, the strict
 * sentence, the frames) and the person's direction never give way.
 */
const FIT_STEPS: Partial<Fit>[] = [
  { archviz: false },
  { beats: 3 },
  { moving: 3 },
  { names: 8 },
  { names: 6 },
  { how: 80, what: 80 },
  { action: 200, end: 120 },
  { name: 40 },
  { beats: 2 },
  { how: 40, what: 48, action: 120, end: 60 },
  { focus: false },
  { name: 28, moving: 2 },
  { beats: 0, end: 0 },
  { how: 0, action: 80, name: 24 },
];

function directedSentences(shot: ResolvedShot, opts: DirectedOptions, fit: Fit): string[] {
  const move = MOTIONS.find((m) => m.id === shot.camera.move) ?? MOTIONS[0];
  const how = MOVE_STYLES.find((m) => m.id === opts.style) ?? MOVE_STYLES[0];
  const pace = SPEEDS.find((s) => s.id === opts.speed) ?? SPEEDS[1];
  const name = (item: InventoryItem) => clip(item.name, fit.name);
  // A target reads as a thing in the scene: "from the brick facade", never
  // "from brick facade" (a name that already has its article keeps it).
  const target = (item: InventoryItem) => (/^(the|a|an) /i.test(item.name) ? name(item) : `the ${name(item)}`);
  // As buildVideoPrompt: a locked-off or focus-only shot has no travel to
  // style (or to aim), and only a handheld camera still breathes.
  const travels = move.id !== 'still-life' && move.id !== 'focus-pull';
  const { from, to, crops } = shot.camera;
  const path = !travels
    ? ''
    : from && to
      ? `, travelling from ${target(from)} toward ${target(to)}`
      : to
        ? `, travelling toward ${target(to)}`
        : from
          ? `, travelling from ${target(from)}`
          : '';
  const camera = travels
    ? `${move.camera}, moving ${pace.camera}, ${how.camera}`
    : how.id === 'handheld'
      ? `${move.camera.replace('on a tripod', 'held by hand')}, with only a subtle, natural handheld breathing`
      : move.camera;
  const cropped = crops
    ? ` The clip opens on the supplied first frame, a tighter crop of this photograph, and ends exactly on the supplied last frame, ${
        crops.end ? 'another crop of the same photograph' : 'the whole photograph'
      }; the camera travels between them and reveals only what lies between those two framings.`
    : '';
  const moving = shot.moving.slice(0, fit.moving);
  const movingParts = moving.map((m) => [name(m.item), fit.how ? bare(clip(m.how, fit.how)) : ''].filter(Boolean).join(' '));
  const action = bare(clip(shot.people.action, fit.action));
  const beats = pickBeats(shot.beats, fit.beats)
    .map((b) => ({ at: b.at, what: bare(clip(b.what, fit.what)) }))
    .filter((b) => b.what);
  const end = fit.end ? bare(clip(shot.end, fit.end)) : '';
  const extra = bare(opts.direction.trim());
  return [
    'A single continuous, photorealistic cinematic shot that starts exactly on this photograph.',
    `${camera}${path}.${cropped}`,
    `${existSentence(shot.inventory.slice(0, fit.names).map(name), shot.inventory.length)} ${LOCK_REST}`,
    movesSentence(moving, movingParts, shot.people.present),
    shot.people.present ? directedPeopleSentence(action) : 'No people or animals appear.',
    beats.length
      ? `Timing over ${opts.seconds} seconds: ${beats.map((b) => `at ${Math.round(b.at * opts.seconds)} s ${midSentence(b.what)}`).join('; ')}.`
      : '',
    fit.focus && shot.focus ? `Focus starts on ${name(shot.focus.start)} and ends on ${name(shot.focus.end)}.` : '',
    end ? `The shot ends on ${endObject(end)}.` : '',
    STRICT_SENTENCE,
    extra ? `Also, using only what is already in the image: ${extra}.` : '',
    ...frameSentences(opts.frames),
    fit.archviz && opts.archviz && how.id !== 'handheld' ? ARCHVIZ_DIRECTED_SENTENCE : '',
    how.id === 'handheld'
      ? 'High-end cinema camera footage with natural motion blur and film grain.'
      : 'Smooth, stable, high-end cinema camera footage with natural motion blur and film grain.',
  ].filter(Boolean);
}

/** The directed prompt, trimmed by `FIT_STEPS` until it is within `DIRECTED_BUDGET`. */
function fitDirectedPrompt(shot: ResolvedShot, opts: DirectedOptions): string {
  let fit: Fit = { archviz: true, beats: 5, moving: 6, names: 12, name: 80, how: 200, what: 200, action: 400, end: 300, focus: true };
  let prompt = directedSentences(shot, opts, fit).join(' ');
  for (const step of FIT_STEPS) {
    if (prompt.length <= DIRECTED_BUDGET) break;
    fit = { ...fit, ...step };
    prompt = directedSentences(shot, opts, fit).join(' ');
  }
  return prompt;
}

/**
 * The clip's prompt from a resolved shot: the camera move described against
 * real elements, the inventory lock, only the moving things moving, the
 * people already there with their one action, the timing, focus and the end
 * frame, then the strict rule, the person's direction, the frames and the
 * closing line, as `buildVideoPrompt` closes.
 */
export function buildDirectedVideoPrompt(shot: ResolvedShot, opts: DirectedOptions): string {
  return fitDirectedPrompt(shot, opts);
}

const LOCK_MAX = 700;

/**
 * "Only these exist…; only these move…" for Recreate in 4K, at most 700
 * characters: the names shorten and the list shows fewer before it runs over.
 */
export function inventoryLock(shot: ResolvedShot): string {
  let out = '';
  for (const cap of [80, 48, 32, 24]) {
    const name = (item: InventoryItem) => clip(item.name, cap);
    const moves = movesSentence(
      shot.moving,
      shot.moving.map((m) => name(m.item)),
      shot.people.present
    );
    for (let n = shot.inventory.length; n >= 1; n--) {
      out = `${existSentence(shot.inventory.slice(0, n).map(name), shot.inventory.length)} ${moves}`;
      if (out.length <= LOCK_MAX) return out;
    }
  }
  return out;
}

/** The recreate prompt and the person's note, then the inventory lock. */
export function buildRecreateDirectedPrompt(note: string, shot: ResolvedShot): string {
  return `${buildRecreatePrompt(note)} ${inventoryLock(shot)}`;
}

const SUMMARY_MAX = 140;

/** One line for a take or a film card: "Pan right from the pool to the pavilion; moves: the pool, the hedge" (at most 140 characters). */
export function shotSummary(shot: ResolvedShot): string {
  const move = shot.camera.move;
  const travels = move !== 'still-life' && move !== 'focus-pull';
  const [a, b] = travels
    ? [shot.camera.from, shot.camera.to]
    : move === 'focus-pull' && shot.focus
      ? [shot.focus.start, shot.focus.end]
      : [undefined, undefined];
  for (const cap of [80, 40, 24, 16]) {
    const name = (item: InventoryItem) => clip(item.name, cap);
    const path = a && b ? ` from ${name(a)} to ${name(b)}` : b ? ` toward ${name(b)}` : a ? ` from ${name(a)}` : '';
    for (const shown of [6, 3, 2, 1]) {
      const list = shot.moving.slice(0, shown).map((m) => name(m.item));
      const rest = shot.moving.length - list.length;
      const moves = list.length ? `${list.join(', ')}${rest ? ` and ${rest} more` : ''}` : 'nothing';
      const line = `${motionName(move)}${path}; moves: ${moves}`;
      if (line.length <= SUMMARY_MAX) return line;
    }
  }
  return `${motionName(move)}; moves: ${shot.moving.length ? `${shot.moving.length} elements` : 'nothing'}`;
}

/** How the shot director directs, written for one clip; rides on its system prompt. */
export const SHOT_DOCTRINE = [
  'SHOT METHOD',
  'The house rule comes before everything below. The photograph is the whole truth of the place: nothing is invented that it does not contain. No new objects, furniture, plants, buildings, vehicles, animals, people, signs, sky features or light sources, and no space it does not show. The camera must never reveal what lies past the edges of the image or behind anything in it. Where the craft below and the house rule disagree, the house rule wins.',
  '1. One idea per shot. A clip carries one idea you could say in a clause, such as "the eye travels from the water to the pavilion" or "the garden breathes while the house holds still". Choose the one move that serves it, or none: a locked-off shot where only water and leaves move is often the strongest choice.',
  '2. A motivated move with an end state. The camera moves because something in the picture leads it: a line of paving, the edge of a pool, a gaze, the fall of light. Name the real element it starts from and the real element it ends on, and plan the last frame as carefully as the first. A move with no end state is drift; never plan drift.',
  '3. Only what lives moves. Water ripples, falls and reflects; leaves and branches stir; fabric lifts and settles; flames flicker; clouds slide slowly; the people already there make one small action. Stone, timber, glass, metal, furniture and lamps hold still, and the light only shifts as it would in those few seconds: never a new source or a new shadow.',
  '4. Behaviour, not emotion. For the people already in the frame, write what bodies do, where they look and where they stop: "the woman by the railing turns her head toward the pool and holds", never "a peaceful moment". One action, with a start and an end state. No one enters, leaves, appears or is added, and no one talks. Each person keeps the side the photograph shows: someone seen from behind keeps their back to the camera (a slow step away, a weight shift, a hand to the hair, the breeze in their clothes), never a turn that would show a face the photograph does not.',
  '5. Beats are changes. Split the clip into two to five moments, each a visible change: the camera arrives, a reflection settles, the focus lands. Name real elements in every beat.',
  '6. Concrete words. Name each element as the photograph shows it, with its colour, material or place ("the low box hedge on the left", "the teak lounger by the pool"). Never write cinematic, stunning, dramatic or luxurious: they change no decision.',
  '7. Targeted negatives. If a beat or the action must forbid something, name the instance at its end ("the gate stays shut", "no one steps onto the lawn"), never a category, and only the risks this shot really has.',
  'Before answering, check: every element you name is visible in the images; the move ends on something real; only things that move in life are in moving; the people action brings no one in; nothing you wrote needs space the photograph does not show.',
].join('\n');

export const SHOT_DIRECTOR_SYSTEM = [
  'You direct one short clip that starts on one photograph of an architecture or landscape project. You read the photograph, list what is really in it, and plan the camera, what moves, what any people already there do, the timing and the last frame, all from what you can see. Nothing that is not in the photograph may appear, and the camera must never reveal space outside it. Answer with one JSON object and nothing else.',
  SHOT_DOCTRINE,
].join('\n\n');

/** The exact JSON example the planner prompt shows. */
export const SHOT_PLAN_SHAPE =
  '{"inventory":[{"id":"pool","name":"the long reflecting pool","where":"centre, lower half","kind":"water","moves":true}],"people":{"present":false,"count":0,"action":""},"camera":{"move":"push-in","from":"paving","to":"pavilion","why":"..."},"moving":[{"id":"pool","how":"ripples slowly, reflections sliding"}],"beats":[{"at":0,"what":"..."},{"at":0.5,"what":"..."},{"at":1,"what":"..."}],"focus":{"start":"pool","end":"pavilion"},"end":"...","rationale":"..."}';

/** The planner prompt for one clip: its length, its images, the camera grammar here, the person's preset and direction, and the answer's shape. */
export function shotDirectorPrompt(input: {
  seconds: number;
  videoModel: VideoModelId;
  canEndFrame: boolean;
  userKeyframes: boolean;
  frames: number;
  presetMove: MotionId;
  direction: string;
  directorStyle?: string | undefined;
  /** The Director page's clips: SHOT_CRAFT goes in the prompt. */
  craft?: boolean | undefined;
  people: boolean;
}): string {
  const allowed = grammarMoves(input.canEndFrame, input.userKeyframes);
  const preset = motionName(input.presetMove);
  const share = `${Math.round(CROP_SCALE * 100)} percent`;
  const direction = bare(input.direction.trim());
  return [
    `The clip runs ${input.seconds} seconds.`,
    input.frames > 1
      ? `Image 1 is the photograph the clip starts on; images 2 to ${input.frames} are the frames the clip must pass through or end on, in that order. The inventory lists what these images show, and nothing else may appear.`
      : 'Image 1 is the photograph the clip starts on. The inventory lists what it shows, and nothing else may appear.',
    input.userKeyframes
      ? 'The clip must travel from image 1 through the supplied frames; any move that gets there is allowed.'
      : input.canEndFrame
        ? `This model can end on a tighter crop of the same photograph, so pull out, pan, tilt and crane are allowed when the picture motivates them; never an arc. With one of those moves the clip opens on ${share} of the photograph and ends on another ${share} of it: a pan right travels from the left part to the right part and a pan left the reverse, a tilt up or crane up from the lower part to the upper part and a tilt down or crane down the reverse, and a pull out opens on the centre and ends on the whole photograph. Choose from and to inside those parts.`
        : 'Choose only from: locked off, push in, focus pull, track left, track right.',
    `camera.move is one of these ids: ${allowed.map((id) => `"${id}" (${motionName(id).toLowerCase()})`).join(', ')}.`,
    allowed.includes(input.presetMove)
      ? `The person's preset is ${preset}; keep it unless the picture argues for another move.`
      : `The person's preset is ${preset}, which this clip cannot use without showing what the photograph does not; use ${motionName(DOWNGRADE[input.presetMove])} unless the picture argues for another allowed move.`,
    direction ? `The person asks: ${direction}. Follow it as far as the photograph allows.` : '',
    lensBlock(input.directorStyle),
    input.craft ? SHOT_CRAFT : '',
    input.people
      ? 'Any people already in the photograph stay the same people and may make one small action; add no one.'
      : 'There are no people in this photograph and none may be added.',
    'inventory: list 3 to 24 named elements you can see, the largest and most important first. Each has an id (a short lowercase slug such as "pool" or "lamp-post": letters, digits and hyphens, unique, at most 32 characters), a name as the photograph shows it, with its colour, material or place (at most 80 characters), where it sits in the frame (at most 60 characters, such as "left third, foreground"), a kind (water, vegetation, people, fabric, light, structure, object, sky or ground) and moves, which is true only for things that move in life: water, leaves and branches, fabric, flames, clouds, people. Walls, paving, glass, metal, furniture and lamps are false.',
    input.people
      ? 'people: present is true only when people are visible, count is how many, and action is the one small thing they do, written as behaviour with where they look and an end state (such as "the woman by the railing turns her head toward the pool and holds"), at most 400 characters, or "" when there are none. Only the people already there may move: no one enters, arrives, appears or joins.'
      : 'people: present is false, count is 0 and action is "".',
    'camera: move is one id from the list above; from and to are the inventory ids of the real elements the move starts from and ends on ("" for a locked-off shot or a focus pull); why is one sentence on what in the picture motivates the move.',
    'moving: the inventory ids with moves true that move in this clip, each with how it moves in a few concrete words (such as "ripples slowly, reflections sliding"), at most 200 characters. Leave out everything that does not move in life.',
    'beats: two to five moments in order; at is the moment as a fraction of the clip, from 0 (the first frame) to 1 (the last), and what is one visible change that names real elements, at most 200 characters.',
    'focus: the inventory ids the focus starts and ends on, or null when the focus holds.',
    "end: the last frame in one sentence, naming the real element it rests on. rationale: the shot's one idea, in one sentence.",
    'Every why, action, how, what, end and rationale names only elements in your inventory; a clause that names anything else is taken out.',
    'Answer with one JSON object and nothing else, in exactly this shape:',
    SHOT_PLAN_SHAPE,
  ]
    .filter(Boolean)
    .join('\n\n');
}
