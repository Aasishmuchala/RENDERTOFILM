import { z } from 'zod';

import { type CutColour, isNeutral } from './colour.ts';
import { GRADE_IDS, GRADES } from './grades.ts';
import type { EditDoc } from './edits.ts';

/**
 * The AI editor on the Edit tab: Claude reads the timeline, the clips on
 * offer, the visitor's remembered preferences and their message, and answers
 * with one JSON plan the server applies (src/api.ts `applyEditorPlan`).
 */

/** A clip the editor may use, under a short handle ("c1"). */
export type EditorClip = {
  handle: string;
  id: string;
  seconds: number;
  label: string;
};

export const EDITOR_SYSTEM_PROMPT = `You are the film editor inside "Render to Film", an app that makes high-end architectural and landscape films. You cut, grade and polish short cinematic sequences of buildings, interiors, gardens and landscapes, in the taste of luxury real-estate, hospitality and architecture-brand films: calm pacing, long elegant shots, motivated cuts, restrained and true-to-material colour.

You work on a timeline of cuts. Each cut plays part of a clip: from "in" to "out" seconds of that clip. You can:
- reorder, add, remove and trim cuts (return the whole new timeline),
- set the transition between every cut: "hard" cuts or "fade" (cross-dissolve) with a length in seconds,
- colour grade a cut with the built-in grade ("look"): one preset id from the list you are given at a strength, plus small exposure, contrast, saturation and warmth nudges. It is instant and free, so it is your default for any colour request,
- re-render a cut's grade with Aleph ("grade"), only when the user asks for Aleph or for the grade baked into the clip itself,
- make a plain-language visual edit on a cut (change the weather, the season, the time of day, the sky, remove a car, add rain on the water...). Each Aleph grade or edit re-renders that whole clip and costs the user credits, so only use them when they ask for it or clearly want it,
- remember standing preferences for every future session ("always grade warm luxury", "keep cuts under 4 seconds"), and forget ones they no longer want,
- export the final film when they ask for it.

Editing taste: open on the widest establishing view, move closer to details and materials, end on a calm wide or a strong hero frame. Cuts of 3 to 6 seconds feel premium; never make a cut shorter than 1.5 seconds. Fades of 0.5 to 1 second suit slow architectural films. Use the same grade on every cut unless asked otherwise, so the film reads as one piece. Always respect what the user has asked you to remember.

You cannot see the clips; you only know their descriptions. Never invent clips or handles that are not listed.

Answer with ONE JSON object and nothing else:
{
  "reply": "one to three short sentences to the user: what you did and why, in plain words",
  "timeline": [ { "cut": 2, "in": 0, "out": 4.5 }, { "clip": "c3", "in": 1, "out": 6 } ],
  "transition": "hard" | "fade",
  "fadeSeconds": 0.75,
  "look": [ { "cut": 1, "grade": "<preset id>", "strength": 1, "exposure": 0, "contrast": 0, "saturation": 0, "warmth": 0 } ],
  "grade": [ { "cut": 1, "grade": "<preset id>" } ],
  "edit": [ { "cut": 2, "instruction": "make it light rain, wet paving, overcast sky" } ],
  "remember": [ "a short standing preference" ],
  "forget": [ 1 ],
  "export": false
}
Rules for the JSON:
- Leave out any key you are not changing. "reply" is always present.
- In "timeline", keep an existing cut with "cut" (its number in the CURRENT timeline, so its grade and edits stay) or add a fresh copy of a clip with "clip" (its handle). "in" and "out" are seconds of that clip, 0 <= in < out <= the clip's length.
- "look", "grade" and "edit" refer to cut numbers in the timeline AFTER your changes. Grade ids must come from the list. In "look", strength is 0 to 1 and the four nudges are -1 to 1 (0 is unchanged; keep them within +-0.4 for a natural film). A look with grade "none" and every nudge 0 takes the cut back to its original colour; in "grade", "none" takes back an Aleph re-render.
- "forget" lists numbers of remembered preferences to remove.
- Set "export": true only when the user asks to export, render or finish the film.
- If the request is unclear, ask one short question in "reply" and change nothing.`;

function lookNote(c: CutColour | undefined): string {
  if (!c || isNeutral(c)) return '';
  const nudges = (['exposure', 'contrast', 'saturation', 'warmth'] as const)
    .filter((k) => c[k])
    .map((k) => `${k} ${round(c[k])}`);
  return `, look ${c.gradeId} at ${round(c.strength)}${nudges.length ? ` (${nudges.join(', ')})` : ''}`;
}

/** The per-message prompt: the state the editor works from, then the ask. */
export function buildEditorPrompt(
  doc: EditDoc,
  clips: readonly EditorClip[],
  cutNotes: readonly string[],
  message: string
): string {
  const handleOf = new Map(clips.map((c) => [c.id, c.handle]));
  const timeline = doc.timeline.length
    ? doc.timeline
        .map(
          (t, i) =>
            `${i + 1}. clip ${handleOf.get(t.clipId) ?? '(no longer in the library)'}, in ${t.sourceStart}s, out ${round(t.sourceStart + t.duration)}s${cutNotes[i] ? `, ${cutNotes[i]}` : ''}${lookNote(t.colour)}`
        )
        .join('\n')
    : '(empty)';
  const total = doc.timeline.reduce((s, t) => s + t.duration, 0);
  const memory = doc.memory.length
    ? doc.memory.map((m, i) => `${i + 1}. ${m}`).join('\n')
    : '(nothing yet)';
  const recent = doc.messages
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'User' : 'Editor'}: ${m.text.slice(0, 400)}`)
    .join('\n');
  return [
    `Clips you can use:\n${clips.length ? clips.map((c) => `${c.handle}: ${c.seconds}s long, ${c.label}`).join('\n') : '(none yet)'}`,
    `Current timeline (${round(total)}s, ${doc.transition === 'fade' ? `${doc.fadeSeconds}s fades` : 'hard cuts'}):\n${timeline}`,
    `Grade presets:\n${GRADES.map((g) => `${g.id}: ${g.name}, ${g.hint}`).join('\n')}`,
    `Remembered preferences:\n${memory}`,
    recent ? `Conversation so far:\n${recent}` : '',
    `User: ${message}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 40000);
}

const planSchema = z.object({
  reply: z.string().min(1).max(2000),
  timeline: z
    .array(
      z.object({
        cut: z.number().int().positive().optional(),
        clip: z.string().optional(),
        in: z.number().min(0),
        out: z.number().positive(),
      })
    )
    .max(40)
    .optional(),
  transition: z.enum(['hard', 'fade']).optional(),
  fadeSeconds: z.number().positive().max(4.9).optional(),
  look: z
    .array(
      z.object({
        cut: z.number().int().positive(),
        grade: z.enum(GRADE_IDS),
        strength: z.number().min(0).max(1).optional(),
        exposure: z.number().min(-1).max(1).optional(),
        contrast: z.number().min(-1).max(1).optional(),
        saturation: z.number().min(-1).max(1).optional(),
        warmth: z.number().min(-1).max(1).optional(),
      })
    )
    .max(40)
    .optional(),
  grade: z
    .array(z.object({ cut: z.number().int().positive(), grade: z.enum(GRADE_IDS) }))
    .max(40)
    .optional(),
  edit: z
    .array(
      z.object({
        cut: z.number().int().positive(),
        instruction: z.string().min(3).max(600),
      })
    )
    .max(10)
    .optional(),
  remember: z.array(z.string().min(2).max(240)).max(10).optional(),
  forget: z.array(z.number().int().positive()).max(30).optional(),
  export: z.boolean().optional(),
});

export type EditorPlan = z.infer<typeof planSchema>;

export function parseEditorPlan(text: string): EditorPlan | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = planSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The Aleph 2.0 instruction for a plain-language edit on one clip. */
export function videoEditInstruction(instruction: string): string {
  return `${instruction.trim().replace(/\.$/, '')}. Change only that. Keep everything else exactly as it is: the architecture, materials, landscape, camera movement, framing, motion and timing, in a photoreal, cinematic look.`;
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
