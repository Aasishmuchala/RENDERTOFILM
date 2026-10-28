/**
 * Colour grade presets for high-end architectural film. Each one is a grade
 * only: the light, the architecture, the materials, the people and (on
 * video) the camera move and timing stay exactly as they are. Used by the
 * Stills prompt (a grade sentence) and by the Edit tab, which applies a grade
 * to a clip with Aleph 2.0.
 */
export const GRADES = [
  {
    id: 'none',
    name: 'No grade',
    hint: 'Keep the colour as it came out',
    prompt: '',
  },
  {
    id: 'clean-daylight',
    name: 'Clean daylight',
    hint: 'True whites, neutral stone, soft cool shadows',
    prompt:
      'a clean, true-to-material daylight grade: neutral whites, accurate stone, timber and concrete colour, soft slightly cool shadows, gentle contrast and a long, smooth highlight roll-off, like a premium architecture brand film',
  },
  {
    id: 'warm-luxury',
    name: 'Warm luxury',
    hint: 'Honeyed highlights, rich timber, deep warm blacks',
    prompt:
      'a warm luxury-hospitality grade: honeyed highlights, rich warm timber and brass, creamy skin tones, deep warm blacks and a gentle low-contrast curve, like a five-star resort film',
  },
  {
    id: 'nordic-minimal',
    name: 'Nordic minimal',
    hint: 'Desaturated, airy, pale greys and soft greens',
    prompt:
      'a Nordic minimal grade: lightly desaturated, airy and bright, pale greys, soft muted greens, lifted shadows and very low contrast, calm and quiet',
  },
  {
    id: 'teal-amber',
    name: 'Teal and amber',
    hint: 'Cinematic split: warm light, cool shadows',
    prompt:
      'a restrained cinematic teal-and-amber split: warm amber in the lit surfaces and skin, cool teal in the shadows and sky, kept subtle so materials still read true',
  },
  {
    id: 'film-print',
    name: 'Film print',
    hint: 'Kodak 2383 print look, dense blacks, fine grain',
    prompt:
      'a motion-picture print film emulation (Kodak Vision3 negative printed to 2383): dense rich blacks, slightly warm mids, gently compressed highlights, organic colour separation and fine, even film grain',
  },
  {
    id: 'blue-hour-luxe',
    name: 'Blue hour luxe',
    hint: 'Deep blue ambience, glowing warm interiors',
    prompt:
      'a blue-hour luxury grade: deep, clean blue ambience in the sky and shadows against glowing warm interior and landscape lighting, crisp contrast between the two, no crushed detail',
  },
  {
    id: 'golden-glow',
    name: 'Golden glow',
    hint: 'Sun-kissed warmth, soft bloom on highlights',
    prompt:
      'a golden sun-kissed grade: warm golden highlights with a soft bloom, peachy mids, gentle haze in the light and warm, open shadows',
  },
  {
    id: 'moody-contrast',
    name: 'Moody contrast',
    hint: 'Low key, deep shadows, sculpted light',
    prompt:
      'a moody low-key grade: deeper shadows, sculpted contrast on the architecture, slightly reduced saturation and a dark, premium feel, keeping detail in the blacks',
  },
  {
    id: 'bleach-bypass',
    name: 'Bleach bypass',
    hint: 'Silvery, desaturated, strong contrast',
    prompt:
      'a bleach-bypass grade: silvery and desaturated, strong contrast, metallic highlights and hard-edged shadows, giving concrete and steel a raw, editorial edge',
  },
  {
    id: 'soft-pastel',
    name: 'Soft editorial',
    hint: 'Pastel tones, lifted blacks, magazine feel',
    prompt:
      'a soft editorial pastel grade: lifted matte blacks, pastel skies, gentle peach and sage tones and low contrast, like an architecture magazine spread',
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    hint: 'Rich black and white, full tonal range',
    prompt:
      'a rich black-and-white grade: full tonal range from deep blacks to clean whites, strong form and texture in the architecture, a light orange-filter response so skies darken slightly',
  },
] as const;

export type GradeId = (typeof GRADES)[number]['id'];
export const GRADE_IDS = GRADES.map((g) => g.id) as [GradeId, ...GradeId[]];

export function gradeName(id: string | undefined): string {
  return GRADES.find((g) => g.id === id)?.name ?? 'No grade';
}

export function gradePrompt(id: string | undefined): string {
  return GRADES.find((g) => g.id === id)?.prompt ?? '';
}

/** The grade sentence a still's prompt ends with; empty for "No grade". */
export function stillGradeSentence(id: string | undefined): string {
  const p = gradePrompt(id);
  return p
    ? `Colour grade the final image with ${p}. The grade changes colour and tone only: it never changes the light direction, the architecture, the materials or what is in the frame.`
    : '';
}

/**
 * The Aleph 2.0 instruction that grades a clip. Only colour and tone change;
 * every frame keeps its content, motion and timing.
 */
export function videoGradeInstruction(id: string | undefined): string {
  return `Apply ${gradePrompt(id)}. Change only the colour grade and tonal contrast. Keep every frame's content exactly as it is: the same architecture, materials, landscape, water, people, camera movement, motion and timing. Do not add, remove or move anything.`;
}
