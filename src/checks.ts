import { z } from 'zod';

import {
  ACTIVITIES,
  AGES,
  ETHNICITIES,
  resolvePeopleOptions,
  WARDROBES,
  type PeopleOptions,
} from './looks.ts';

/**
 * What the automatic people check judges, shared by the server (the
 * reviewer's rubric in src/api.ts) and the client report (labels per id).
 */
export const PEOPLE_CHECKS = [
  {
    id: 'scale',
    name: 'Height and scale',
    ask: 'Is every person a believable real-world height (about 1.6 to 1.85 m for adults) when measured against what stands right beside them: pool curbs and planter edges reaching just below the knee, bench seats at knee height, street lamps about two and a half to three times a person, tree trunks about as thick as a torso with the lowest branches above head height, the wall many times taller? Does each person shrink correctly with distance along the paving, with standing adults keeping their heads near the camera eye-level line?',
  },
  {
    id: 'grounding',
    name: 'Feet, weight and physics',
    ask: 'Does every foot rest on the ground plane with no floating, sinking or sliding? Are poses balanced with believable weight, gait and seated contact, clothing and hair hanging with gravity, hands touching real surfaces? Does each person pass correctly in front of or behind the objects around them?',
  },
  {
    id: 'light',
    name: 'Light and shadows',
    ask: "Does the light on each person come from the same direction, colour and softness as the scene's own light? Do their contact and cast shadows match the direction, length and softness of the shadows of nearby trees and lamps? Do people near water have reflections?",
  },
  {
    id: 'faces',
    name: 'Faces and hands',
    ask: 'Are faces anatomically correct and photographic, like real people photographed on location, with natural asymmetry, natural eyes, real skin texture with pores and fine lines, and no smearing, warping, duplicated, airbrushed or plastic-looking features? Are hands well formed with five fingers? Are bodies complete, with no merged or missing limbs?',
  },
  {
    id: 'blend',
    name: 'Blends with the photo',
    ask: 'Do the people share the same white balance, exposure, contrast, colour grade, grain, focus falloff and atmospheric haze as everything at the same distance, or do any look pasted in, too sharp, too clean or lit differently?',
  },
  {
    id: 'fidelity',
    name: 'Scene unchanged',
    ask: 'Compared with the original render, are the architecture, sculptures, trees, lamps, pools, planting, paving and overall layout the same, with people as the only addition, nothing added, removed or moved?',
  },
] as const;

export type CheckId = (typeof PEOPLE_CHECKS)[number]['id'];

const CHECK_IDS = PEOPLE_CHECKS.map((c) => c.id) as [CheckId, ...CheckId[]];

export const checkReportSchema = z.object({
  verdict: z.enum(['pass', 'issues']),
  score: z.number().min(0).max(10),
  summary: z.string(),
  checks: z.array(
    z.object({ id: z.enum(CHECK_IDS), ok: z.boolean(), note: z.string() })
  ),
  fixes: z.string(),
});

export type CheckReport = z.infer<typeof checkReportSchema>;

export const CHECK_SYSTEM_PROMPT =
  'You are a meticulous senior compositor and photo editor reviewing AI-generated architectural film stills before they go to a client. You judge only what you can see, you are strict about anything that would make a viewer doubt the people are real, and you answer with JSON only.';

/** What the take asked for, in words the reviewer can judge against. */
function askedFor(
  asked: { [K in keyof PeopleOptions]?: PeopleOptions[K] | undefined } | undefined,
  people: string | undefined,
  castSheet: boolean,
  scene: string | undefined
): string {
  const o = resolvePeopleOptions(asked);
  const pick = <T extends { id: string; prompt: string }>(list: readonly T[], id: string) =>
    (list.find((x) => x.id === id) ?? list[0]!).prompt;
  // A Lifestyle frame's brief already says who is there and what they wear,
  // so only the household's heritage is added, and the brief (which the scene
  // holds, with the shot's people size after it) is not repeated.
  return [
    scene
      ? `The take asked for this residents' moment: ${scene.trim()} The residents are ${pick(ETHNICITIES, o.ethnicity)}.`
      : `The take asked for ${pick(ETHNICITIES, o.ethnicity)}, ${pick(AGES, o.age)}, wearing ${pick(WARDROBES, o.wardrobe)}, ${pick(ACTIVITIES, o.activity)}.`,
    people?.trim() && !scene?.includes(people.trim()) ? `The user added: ${people.trim()}.` : '',
    castSheet
      ? 'A cast sheet of real people was supplied as a second reference; its people should be recognisable in image 2 by face, skin tone, hair, build and clothing, with none of the sheet’s own background or lighting.'
      : '',
    'Judge whether the people match this brief as well as whether they look real: wrong heritage, age or clothing for the brief is a failed check on "faces" or "blend", named in the note.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildCheckPrompt(
  asked?: { [K in keyof PeopleOptions]?: PeopleOptions[K] | undefined },
  people?: string,
  castSheet = false,
  /** A Lifestyle moment's scene (src/lifestyle.ts), judged in place of the activity. */
  scene?: string
): string {
  const rubric = PEOPLE_CHECKS.map((c) => `- "${c.id}" (${c.name}): ${c.ask}`).join('\n');
  return [
    'Image 1 is the original architectural render. Image 2 is a photoreal film still generated from it with people added.',
    askedFor(asked, people, castSheet, scene),
    'Review the people in image 2, and the scene against image 1, on each of these checks:',
    rubric,
    'Mark a check ok only when it holds for every person in the frame. When it fails, the note names which person (by position, e.g. "the man on the left pool curb") and exactly what is wrong; when it holds, the note says in a few words why.',
    'Score the whole frame from 0 to 10 for how convincingly real the people are. The verdict is "pass" only when every check is ok.',
    'In "fixes", write short, positive instructions for the next take that would correct every failed check, naming the people and the scene objects to measure them against (e.g. "make the woman by the second lamp shorter, her head reaching about a third of the lamp height"). Leave it empty when the verdict is "pass".',
    'Answer with one JSON object and nothing else, in exactly this shape:',
    '{"verdict":"pass"|"issues","score":0-10,"summary":"one sentence","checks":[{"id":"scale","ok":true,"note":"..."}, ...one entry per check id above, in that order],"fixes":"..."}',
  ].join('\n\n');
}

/** Pull the JSON object out of the reviewer's answer, tolerating a code fence. */
export function parseCheckReport(text: string): CheckReport | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = checkReportSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
