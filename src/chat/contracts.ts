// The chat tool contracts: the 12 tools of PLAN-13 section 5 as zod schemas (what
// we validate with), the JSON Schema each one sends the model, its class, its
// description, and a hash of the lot. Pure. The loop validates every tool_use
// with parseToolInput and hands the model its one-sentence message on a miss.
//
// A strict tool cannot carry bounds (minimum, maximum, lengths, item counts), so
// the schema the model sees has them folded into each field's description; the
// zod schema still enforces them.
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { canonicalJson, type ToolClass, type ToolDef } from './domain.ts';

export type { ToolDef } from './domain.ts';

// ---------------------------------------------------------------------------
// Shapes shared by more than one tool

const id = z.string().min(1);
const key = z.string().min(1);
const unit = z.number().min(0).max(1);

const region = z
  .strictObject({ x: unit, y: unit, w: unit, h: unit })
  .describe('The part of the picture, as fractions of its width and height measured from the top left corner.');

const DELIVERABLES = ['h264', 'hevc10', 'prores'] as const;

/** An image is named by exactly one of an uploaded asset or a library still. */
function oneImage(v: { assetKey?: string | undefined; stillId?: string | undefined }): boolean {
  return (v.assetKey === undefined) !== (v.stillId === undefined);
}
const ONE_IMAGE = { message: 'Give exactly one of assetKey or stillId.', path: ['assetKey'] };

/** PLAN-13 RunSpec, as the model proposes it. */
export const runSpecSchema = z.strictObject({
  kind: z.enum(['lifestyle_film', 'stills', 'clips', 'cut', 'master']).describe('What the run makes.'),
  lifestyleJobId: id.optional().describe('A lifestyle plan made earlier in this chat.'),
  storyboardJobId: id.optional().describe('A storyboard plan made earlier in this chat.'),
  stillIds: z.array(id).max(60).optional().describe('Library stills to start from instead of making new ones.'),
  seconds: z.number().int().min(5).max(600).optional().describe('Length of the whole film in seconds.'),
  clipSeconds: z.number().int().min(2).max(10).optional().describe('Length of each clip in seconds.'),
  videoModel: z.string().min(1).optional().describe('A video model id from capabilities_get.'),
  imageModel: z.string().min(1).optional().describe('An image model id from capabilities_get.'),
  musicAssetKey: key.nullable().optional().describe('The uploaded music bed to lay under the film, or null for none.'),
  deliverables: z.array(z.enum(DELIVERABLES)).max(3).optional().describe('The master files to make.'),
  transition: z.enum(['hard', 'fade']).optional().describe('How cuts join.'),
  fadeSeconds: z.number().min(0.1).max(4.9).optional().describe('Fade length in seconds when the transition is fade.'),
});

// ---------------------------------------------------------------------------
// The tools

const DEFS = {
  project_get: {
    class: 'read',
    description:
      'Lists what this chat has to work with: the uploaded renders and music, the runs, the open quotes and how much the library holds. Free. Never changes anything.',
    schema: z.strictObject({ threadId: id.describe('The id of this chat thread.') }),
  },
  library_search: {
    class: 'read',
    description:
      'Searches the library of stills, clips or edits by name and returns ids, names, status and thumbnail keys. Free. Never changes anything.',
    schema: z.strictObject({
      kind: z.enum(['still', 'clip', 'edit']).describe('Which part of the library to search.'),
      query: z.string().max(200).optional().describe('Words to match against names.'),
      limit: z.number().int().min(1).max(24).optional().describe('How many results to return.'),
    }),
  },
  image_inspect: {
    class: 'read',
    description:
      'Shows you one image: an uploaded render or a library still, whole or cropped to a region. Free. Never changes the image and never lets you assume detail the picture does not show.',
    schema: z
      .strictObject({
        assetKey: key.optional().describe('An uploaded render, by its asset key.'),
        stillId: id.optional().describe('A library still, by id.'),
        region: region.optional().describe('The part to look at closely. Leave out to see the whole picture.'),
      })
      .refine(oneImage, ONE_IMAGE),
  },
  run_get: {
    class: 'read',
    description:
      'Returns the state of one run: its steps, what each made and any failure. Also reads the plan a direct_shot call asked for, by its taskId. Free. Never changes the run.',
    schema: z.strictObject({ runId: id.describe('The run to read, or the taskId direct_shot answered.') }),
  },
  capabilities_get: {
    class: 'read',
    description:
      'Returns which generation provider is active, which models it offers, whether mastering is available and what things cost. Free. Never changes anything.',
    schema: z.strictObject({}),
  },
  plan_lifestyle: {
    class: 'text',
    description:
      'Plans a lifestyle shot list from uploaded renders: a chapter, a shot type, the people and the light for each frame. Runs a vision call on your key. Never makes images or video and never charges credits.',
    schema: z.strictObject({
      assetKeys: z.array(key).min(1).max(24).describe('The uploaded renders to plan, by asset key.'),
      household: z.string().max(400).optional().describe('Who lives there, in the words the user used.'),
      heritage: z.string().min(1).optional().describe('The household heritage id the Lifestyle tab offers.'),
      directorStyle: z.string().min(1).optional().describe('A director style id the Lifestyle tab offers, or none.'),
    }),
  },
  plan_film: {
    class: 'text',
    description:
      'Plans a storyboard for a film from uploaded renders and a storyline. Runs a vision call on your key. Never makes images or video and never charges credits.',
    schema: z.strictObject({
      assetKeys: z.array(key).min(1).max(12).describe('The uploaded renders to plan, by asset key.'),
      storyline: z.string().min(1).describe('The storyline id the Director tab offers.'),
      story: z.string().max(1500).optional().describe("The user's own story, in their words."),
    }),
  },
  direct_shot: {
    class: 'text',
    description:
      'Plans the camera move and the motion of one clip from what its still shows. Runs a vision call on your key. Never starts a video and never adds anything the still does not contain.',
    schema: z.strictObject({
      stillId: id.describe('The library still the clip starts from.'),
      seconds: z.number().int().min(1).max(60).describe('Length of the clip in seconds.'),
      motion: z.string().min(1).optional().describe('A camera preset id the Video tab offers.'),
      direction: z.string().max(600).optional().describe('A note on the move, in plain words.'),
    }),
  },
  crop_create: {
    class: 'local',
    description:
      'Crops a region out of an uploaded render or a library still and keeps it as a new asset, for a close-up reference. Free. Never changes the original.',
    schema: z
      .strictObject({
        assetKey: key.optional().describe('An uploaded render, by its asset key.'),
        stillId: id.optional().describe('A library still, by id.'),
        region: region.describe('The part to keep.'),
      })
      .refine(oneImage, ONE_IMAGE),
  },
  timeline_edit: {
    class: 'local',
    description:
      "Replaces the cuts, the transition and the fade length of the user's edit. Free. Needs the revision you last read and is refused if the edit has changed since. Never deletes a clip and never exports.",
    schema: z.strictObject({
      items: z
        .array(
          z.strictObject({
            clipId: id.describe('A library clip.'),
            sourceStart: z.number().min(0).describe('Seconds into the clip where the cut starts.'),
            duration: z.number().positive().describe('Seconds the cut plays.'),
          })
        )
        .max(24)
        .describe('The cuts, in playing order.'),
      transition: z.enum(['hard', 'fade']).describe('How cuts join.'),
      fadeSeconds: z.number().min(0.1).max(4.9).describe('Fade length in seconds when the transition is fade.'),
      baseRev: z.number().int().min(0).describe('The edit revision you last read.'),
    }),
  },
  propose_run: {
    class: 'propose',
    description:
      'Prices a run of the film pipeline and shows it to the user as a card. Creates a quote; nothing is charged. Never starts anything; the user approves on the card.',
    schema: runSpecSchema,
  },
  run_cancel: {
    class: 'cancel',
    description:
      'Stops following a run. Free. Never cancels work a provider has already started and never deletes anything made so far.',
    schema: z.strictObject({ runId: id.describe('The run to stop.') }),
  },
} satisfies Record<string, { class: ToolClass; description: string; schema: z.ZodType }>;

export type ToolName = keyof typeof DEFS;
export type ToolInputs = { [N in ToolName]: z.infer<(typeof DEFS)[N]['schema']> };

/** The 12 names, sorted. */
export const TOOL_NAMES = (Object.keys(DEFS) as ToolName[]).sort();

// ---------------------------------------------------------------------------
// JSON Schema for the model

type Json = Record<string, unknown>;

// Keywords a strict tool rejects. minItems 0 and 1 are fine and stay.
const UNSUPPORTED = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'maxItems',
]);

/** The bounds on a node, said in words. */
function boundNotes(n: Json): string[] {
  const notes: string[] = [];
  // .int() carries the safe-integer range; that is no bound worth telling the model.
  const lo = n['minimum'] === -Number.MAX_SAFE_INTEGER ? undefined : n['minimum'];
  const hi = n['maximum'] === Number.MAX_SAFE_INTEGER ? undefined : n['maximum'];
  if (lo !== undefined && hi !== undefined) notes.push(`Between ${lo} and ${hi}.`);
  else if (lo !== undefined) notes.push(`At least ${lo}.`);
  else if (hi !== undefined) notes.push(`At most ${hi}.`);
  if (n['exclusiveMinimum'] !== undefined) notes.push(`Greater than ${n['exclusiveMinimum']}.`);
  if (n['exclusiveMaximum'] !== undefined) notes.push(`Less than ${n['exclusiveMaximum']}.`);
  if (n['maxLength'] !== undefined) notes.push(`At most ${n['maxLength']} characters.`);
  if (n['maxItems'] !== undefined) notes.push(`At most ${n['maxItems']} items.`);
  return notes;
}

/** A copy without what a strict tool rejects, every object closed, and the bounds it dropped as notes. */
function strictify(node: Json): { schema: Json; notes: string[] } {
  const out: Json = {};
  const notes = boundNotes(node);
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED.has(k)) continue;
    if (k === 'properties') {
      out[k] = Object.fromEntries(
        Object.entries(v as Json).map(([p, s]) => {
          const r = strictify(s as Json);
          return [p, withNotes(r.schema, r.notes)];
        })
      );
    } else if (k === 'items') {
      out[k] = strictify(v as Json).schema;
    } else if (k === 'anyOf') {
      const branches = (v as Json[]).map(strictify);
      out[k] = branches.map((b) => b.schema);
      for (const b of branches) notes.push(...b.notes);
    } else {
      out[k] = v;
    }
  }
  if (out['type'] === 'object') out['additionalProperties'] = false;
  return { schema: out, notes };
}

function withNotes(schema: Json, notes: string[]): Json {
  if (!notes.length) return schema;
  return { ...schema, description: [schema['description'], ...notes].filter(Boolean).join(' ') };
}

function inputSchema(schema: z.ZodType): Json {
  const r = strictify(z.toJSONSchema(schema, { io: 'input' }) as Json);
  return withNotes(r.schema, r.notes);
}

export const TOOLS: ToolDef[] = TOOL_NAMES.map((name) => ({
  name,
  description: DEFS[name].description,
  input_schema: inputSchema(DEFS[name].schema),
  class: DEFS[name].class,
  strict: true,
}));

/** Changes whenever a name, a schema or a description does: the prompt cache key for the tools block. */
export const toolsHash = createHash('sha256').update(canonicalJson(TOOLS)).digest('hex');

// ---------------------------------------------------------------------------
// Validation

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function pathText(path: PropertyKey[]): string {
  return path.reduce<string>((s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${String(p)}` : String(p)), '');
}

/** Validates one tool_use input. On a miss the message is one sentence naming the first failing path. */
export function parseToolInput<N extends ToolName>(name: N, input: unknown): ParseResult<ToolInputs[N]>;
export function parseToolInput(name: string, input: unknown): ParseResult<unknown>;
export function parseToolInput(name: string, input: unknown): ParseResult<unknown> {
  // The name is the model's; own keys only, so `constructor` or `__proto__` is not a tool.
  const def = Object.hasOwn(DEFS, name) ? (DEFS as Record<string, { schema: z.ZodType }>)[name] : undefined;
  if (!def) return { ok: false, message: `There is no tool called ${name}.` };
  const r = def.schema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0];
  if (!issue) return { ok: false, message: 'Tool input is invalid.' };
  const path = issue.code === 'unrecognized_keys' ? [...issue.path, issue.keys[0] ?? ''] : issue.path;
  const where = path.length ? ` at ${pathText(path)}` : '';
  const why = issue.message.replace(/^Invalid input: /, '').replace(/[.\s]+$/, '');
  return { ok: false, message: `Tool input is invalid${where}: ${why}.` };
}
