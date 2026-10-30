/**
 * How the two planners direct: the Director's storyboard
 * (src/storyboard-api.ts) and the Lifestyle film (src/lifestyle-api.ts).
 * `DIRECTION_DOCTRINE` rides on both planners' system prompts, and a job's
 * optional director lens (`directorStyle`) adds one `lensBlock` to its
 * planner prompt.
 *
 * Distilled, in our own words, from the Cinematic Director skill by
 * wangzhang-wu (https://github.com/wuwangzhang1216/DirectorSKILL, v2.1.0,
 * commit c65ae0d, MIT License, (c) 2026 wangzhang-wu). The files it was
 * read from are kept for attribution and updates in vendor/director-skill/;
 * nothing reads them at runtime. Adapted to this app's job: each frame is a
 * still re-photographed from one render, later animated into a clip, and
 * nothing is ever invented that the render does not contain. Where the
 * skill and the app disagree, the app wins.
 *
 * The lenses teach a director's method, never a film: as the skill says, no
 * specific shot, line, character or plot from a real film is copied, and the
 * planner is told never to write a director's or film's name into a field
 * (those fields reach image prompts). One lens at a time; precedence is the
 * skill's: lens over genre over tone, and the task's own rules over all.
 *
 * Plain text only: nothing here does I/O or imports anything, so the client
 * can import the lens list for its picker.
 */

/** The craft both planners direct by, appended to their system prompts. */
export const DIRECTION_DOCTRINE = [
  'DIRECTION METHOD',
  'Plan this set the way a working film director plans a shoot, then carry every decision inside the fields the task asks for: add no fields and change no format. Each frame is a still re-photographed from one render and later animated into a short clip, so the still is the control point: whatever it fixes, the clip inherits.',
  "The house rule comes first. Where anything below disagrees with the task's own rules, the task's rules win, and above all nothing is invented that the render does not contain: no new objects, furniture, plants, buildings, vehicles, animals or light sources, only the people the task allows and what they carry. What the task says to keep stays exactly as it is. The camera is the render's own viewpoint (or a straight move in along it, where the task allows one), so never plan another.",
  '1. Visual thesis. Before placing any frame, settle one idea for the whole film that you could photograph as a change across the set, such as "the household moves from the edges of the garden to its centre as the day warms" or "the house is first seen whole and empty, then lived in room by room". "Serenity and luxury" is not a thesis. Every frame serves it; when earlier frames are listed, read their thesis and keep it.',
  '2. Story function first. Give every frame one of nine functions and use the word in its beat or why: establishing (place and scale), relation (people with each other or with the place), close-up (one person, one moment), insert or detail (one thing that carries the story), reaction (the consequence of something seen), transition (a move in time, place or register), aftermath (the place just after people leave, held), point of view (what someone in the film sees), reveal (something the audience did not know). A frame with no function is shot as plainly as the task allows, never decorated.',
  '3. Beats are changes, not camera changes. A beat shifts the balance of the film. In a narrative storyline it is a change of pressure: arrival, discovery, gathering, release. In a brand film it is the format\'s own blocks, in order: hook (the opening frames make one striking promise about the place), demonstration (the middle proves it, with life working in these spaces), claim (one frame near the end states the thesis most plainly), end card (the last frame is calm and settled, usually a wide or empty view with clean open space). Positions follow these blocks.',
  '4. Blocking before framing. Decide what bodies do in the space, then let the shot frame it. Place every person relative to something really in the render (a seat, a tree, a lamp post, a doorway, the pool edge) and write their blocking as a start, one action and an end state: "the father walks from the pavilion steps toward the nearest lounger and stops beside it, one hand on its back". Every action has an end state: "she walks" is not blocking, "she walks to the railing and stops, facing the view" is. Elect one mover per frame, or let a group move as one (side by side, same direction, same pace); everyone else holds, seated, reading or standing still. Prefer what a clip renders well: a few slow steps, a head turn, a hand lifted, someone already seated settling. Avoid hand-offs between people, stairs, running, sitting down into furniture, fine hand work and entrances from outside the frame.',
  '5. Behaviour, not emotion. A people brief says what bodies do, where they look and where they stop, never what anyone feels. Not "a joyful family", but "the daughter runs three steps ahead on the lawn and stops to look back at her mother".',
  '6. One action per frame. Each frame carries one primary action, and its clip gets one camera behaviour at most; no move at all is a valid choice and often the best one, so plan every frame to read with the camera locked. Never stack unrelated actions in one frame.',
  "7. Continuity is engineered. Name the invariants and keep them word for word through a chapter or part of the story: who the people are (by the task's role or preset names only; the app supplies each person's fixed look, so never re-describe a face, hair or clothes, because paraphrase is how identity drifts), their wardrobe as given, the time of day and the light direction. Light means one sun per frame and one shadow family. Place the sun where the render's geometry allows (open sky on that side), agreeing with the render's own shadows wherever the frame keeps them; the task's rules say when a frame is relit instead. Through a chapter keep the hour and the sun's height the same and describe the same light in the same words; its side relative to the camera may change only because different renders face different ways.",
  "8. Cut geometry. Read the frames in film order as a cut. Neighbours that show the same space from a similar viewpoint must differ by two steps on the size ladder (wide, mid, close, detail) or by one step plus a viewpoint at least 30 degrees different; one step on the same axis reads as a stutter. Where you choose the shot, choose it to clear the cut; where the size is the render's own, order the frames so near-identical views are not neighbours. Break this only for a deliberate match (the same composition at a later hour, a shape echoed across spaces) and say so in the why or beat.",
  '9. Targeted negatives. If a brief must forbid something, name the instance at the end of the brief ("no second lounger, no lamp switched on"), never a category ("nothing modern", "no clutter"), and only the risks this frame really has. Long lists dilute and can invite what they forbid.',
  '10. Concrete words. Name sources and positions, not moods: say where the light lands and where people stand, never that a frame feels cinematic, dramatic or luxurious. Cut every word that does not change a decision.',
  "Director lens. When the task names a director lens, it sets the craft for the whole set: camera habit, shot-size bias, composition, light quality, palette and pace. It outranks the genre, and the genre outranks the storyline's tone or the chapter's mood; the task's rules outrank all three. One lens at a time. Apply it only through the choices the task offers (the order of frames, the shot, the presets, the blocking, the light brief), never by adding what the render lacks. Use its method only: copy no shot, line, character or plot from any real film, and never write the director's name or a film title into any field.",
  'Before answering, check: every frame has a function you could state in a clause; every person has a start, an action and an end state beside something real; no field names a feeling; neighbouring frames clear the cut; the invariants read the same through each chapter; no field mentions anything the render does not show.',
].join('\n');

/**
 * The director lenses a plan can be directed with, one at a time, each
 * distilled from its module's style parameters (lens kit, camera, shot-size
 * bias, composition, lighting, palette, pace). `none` leaves the craft to the
 * genre and tone. Methods only, never a film's shots.
 */
export const DIRECTOR_LENSES = [
  {
    id: 'none',
    name: 'None',
    summary: 'No director lens: the storyline or chapters and the genre set the craft.',
    params: '',
  },
  {
    id: 'spielberg',
    name: 'Steven Spielberg',
    summary: 'The face that sees comes before the thing it sees; wonder always lands second.',
    params:
      'Lenses 21, 35, 50, 135 mm. Camera: slow dolly-in to a close-up, walking-pace follow, crane down to eye level, a pan linking a person to what they see; no dutch angle or orbit. Size bias: medium close-up reaction, wide with three planes of depth, medium two-shot, insert on a carried object. Composition: three-plane depth, silhouettes against a bright source, doorway frames, a clear way out in every wide. Light: warm 3:1, practical, a visible shaft of hard light, rims on hair. Palette: amber, tungsten, grey-green, one red accent. Pace: 3 to 9 s, cutting on the reaction.',
  },
  {
    id: 'hitchcock',
    name: 'Alfred Hitchcock',
    summary: 'Tell the audience first, then let the character walk into it; the wait is the scene.',
    params:
      'Lenses 28, 50, 100, 135 mm. Camera: locked frames held past comfort, a slow push-in on a detail, a pan along an eyeline, a high view over stairs; no handheld or orbit. Size bias: extreme close-up on an object, close-up reaction, point-of-view medium, an obstructed two-shot, one wide as the map. Composition: a foreground obstruction over a fifth of the frame, frames within frames, geometric shadows on walls, empty space where something will arrive. Light: hard, 4:1, practical. Palette: neutral greys and creams, one strong red at a turn. Pace: 4 to 9 s: look, seen, reaction.',
  },
  {
    id: 'kubrick',
    name: 'Stanley Kubrick',
    summary: 'The architecture outranks the person: wide lens, one-point perspective, constant-speed moves.',
    params:
      'Lenses 18, 25, 35 mm. Camera: locked symmetrical frames, a constant-speed dolly along the vanishing axis with no easing, a low follow, a perpendicular overhead insert; never handheld or reframed. Size bias: symmetrical wide on a strong vanishing point, frontal medium on the centre axis, overhead insert, the empty space. Composition: centred one-point perspective, bilateral symmetry, the subject on the centre line, rooms as funnels. Light: hard, visible, symmetrical sources at 2:1. Palette: cold white, grey, black, one saturated accent per space. Pace: holds of 12 to 40 s.',
  },
  {
    id: 'kurosawa',
    name: 'Akira Kurosawa',
    summary: 'A long lens compresses groups into bands; weather works on bodies; the wait outlasts the event.',
    params:
      'Lenses 50, 100, 250 mm. Camera: a lateral track across a group, a long-lens locked hold on people waiting, a pan along a line, one decisive push in depth; no orbit or slow motion. Size bias: extreme wide with figures under a sixth of the frame height, compressed bands of people, a close-up on a face, feet on the ground. Composition: stacked lateral bands, a wedge pointing at the event, high ground against low, weather between camera and subject. Light: hard, 6:1, backlight turning rain, dust and breath into bright lines. Palette: earth, mud, wet black. Pace: 8 to 20 s waits.',
  },
  {
    id: 'scorsese',
    name: 'Martin Scorsese',
    summary: 'Desire drags the camera: energy sells the rise, then stillness lets the cost land.',
    params:
      'Lenses 18, 27, 40, 75 mm. Camera: a steadicam take entering a space, a dolly that accelerates then stops hard, a lateral track along a bar or table, locked and frontal for direct address; no aimless drift. Size bias: tracking medium, close-up on excitement, a wide of the room as a social map, inserts on hands and glasses. Composition: the subject centred with the world streaming past, background people with business of their own, a practical in frame. Light: hard, 5:1, practicals in conflict. Palette: saturated reds, greens, sodium yellow, gold. Pace: 1.5 to 3 s rising, 8 to 15 s falling.',
  },
  {
    id: 'fellini',
    name: 'Federico Fellini',
    summary: 'The strangeness lives on real bodies, faces and costume, and the camera drifts through the crowd.',
    params:
      'Lenses 18, 25, 32 mm. Camera: a drift through a crowd at walking pace, a pan handing off from face to face, a frontal wide-angle close-up, a crane rising over a procession; no locked symmetry or long-lens compression. Size bias: a wide of the whole procession, a frontal close-up of one face, tracking medium through bodies, a high angle turning the crowd into a pattern. Composition: figures entering from both edges, passers-by in the foreground, one person lifted above the crowd. Light: stage-like pools softened by haze, 4:1. Palette: pink, gold, wine red, sky blue. Pace: 6 to 14 s.',
  },
  {
    id: 'bergman',
    name: 'Ingmar Bergman',
    summary: 'The camera sits on the eyeline, a long lens keeps the whole face sharp, and it refuses to cut.',
    params:
      'Lenses 75, 100, 150 mm. Camera: a locked frontal close-up on the eyeline, two faces with one in profile, a focus pull instead of a cut, an imperceptible push-in; no move the audience can notice. Size bias: extreme close-up filling most of the frame height, two-face composition, medium close-up, an insert of hands. Composition: within 10 degrees of the eyeline, a flat near-black or near-white background, empty space on the side a person avoids, the whole face sharp. Light: one hard source at 90 degrees, 6:1. Palette: grey-blue, grey-green, skin the only warmth. Pace: holds of 20 to 90 s.',
  },
  {
    id: 'tarkovsky',
    name: 'Andrei Tarkovsky',
    summary: "The camera stands still and lets water, light and time perform in the person's place.",
    params:
      'Lenses 28, 35, 50 mm, deep focus. Camera: locked holds, a very slow lateral dolly, a slow push-in on an object, a slow tilt down to water, a walking follow from behind; no handheld, whip pan or drone. Size bias: wide, medium wide, insert, over the shoulder from behind. Composition: three or more planes of depth, a reflective foreground, a figure off centre or turned away, framing through a threshold. Light: soft overcast window light with one warm point, 2:1 to 3:1, no hard shadows, wet surfaces that glow. Palette: mud brown, wet stone grey, moss green, sepia. Pace: holds of 30 to 90 s.',
  },
  {
    id: 'wong-kar-wai',
    name: 'Wong Kar-wai',
    summary: 'The camera stands too close, too obstructed and a beat too late: the shape of the relationship.',
    params:
      'Lenses 18, 25, 85 mm, skipping the middle. Camera: small handheld reframes, step-printed slow motion, shooting through a foreground obstruction, a low corner angle; no tripod symmetry or smooth glide. Size bias: medium close-up, close-up of hands and objects, obstructed medium, over the shoulder. Composition: something in the foreground of every frame, the subject pushed to the edge, frames within doors and windows, reflections in glass, the head cropped at the top. Light: hard practicals, 6:1 to 10:1. Palette: neon green, deep red, tungsten amber. Pace: 1.5 to 4 s, one long slow hold.',
  },
  {
    id: 'nolan',
    name: 'Christopher Nolan',
    summary: 'State the rule first, then let every thread converge on one deadline, all of it physically real.',
    params:
      'Lenses 14, 21, 35, 50 mm, wide and close to the body. Camera: a controlled follow, wide tracking alongside the action, a slow push-in on a mechanism, a crane up to reveal scale; no orbit, no slow motion for beauty. Size bias: medium close-up, wide tracking, extreme wide for scale, a mechanism insert. Composition: a figure against an oversized real structure, a low horizon giving the sky weight, foreground hardware for depth, shapes matched across cuts. Light: real daylight and visible work lights, 3:1 to 4:1. Palette: concrete grey, steel blue, black, khaki. Pace: 2 to 5 s.',
  },
  {
    id: 'villeneuve',
    name: 'Denis Villeneuve',
    summary: 'Shrink the person to a sliver of the frame, then give them time and no explanation.',
    params:
      'Lenses 21, 40, 75 mm. Camera: locked wides, a constant-speed lateral track or push toward the vanishing point, a high overhead, a slow tilt up a structure; no handheld or orbit. Size bias: extreme wide, wide, overhead, then medium close-up. Composition: centre symmetry, one strong horizon near the top or bottom eighth, people at 5 to 15 percent of the frame height, silhouettes against a lit plane, negative space as the subject. Light: soft backlight from a whole wall or sky, 5:1 to 8:1, no hard shadows. Palette: one muted hue per sequence, one warm point. Pace: holds of 8 to 18 s.',
  },
  {
    id: 'fincher',
    name: 'David Fincher',
    summary: 'A long lens cuts the subject out of the background, watched from a place they do not know.',
    params:
      'Lenses 35, 85, 135 mm, mostly long. Camera: precise locked frames, an imperceptible push-in of a few percent, a slow mechanical pull-back, observing through glass; no handheld or wide-angle distortion. Size bias: medium close-up, close-up, a medium from an observing position, inserts on hands and papers, one wide for the geometry. Composition: shallow focus isolating the subject, the background compressed into soft blocks of colour, framing through glass or a door gap. Light: teal shade against amber practicals, 4:1 to 6:1. Palette: teal, charcoal, cold grey, amber. Pace: 4 to 9 s.',
  },
  {
    id: 'refn',
    name: 'Nicolas Winding Refn',
    summary: 'Lock the camera, centre the body, move nothing, and let colour carry the ritual.',
    params:
      'Lenses 25, 40, 75 mm. Camera: locked frontal symmetry, at most one slow constant push, long locked portraits, an overhead centred on the action; no pan, tilt, handheld or orbit. Size bias: frontal medium, frontal close-up, a frontal wide of the room as a stage, extreme close-up on hands. Composition: absolute bilateral symmetry, flat frontal planes, the subject dead centre, colour split into two hard-edged halves, large areas of black. Light: hard, stage-like blocks of colour, 8:1 to 12:1. Palette: magenta and electric blue, accents of red and violet. Pace: holds of 10 to 25 s.',
  },
  {
    id: 'bi-gan',
    name: 'Bi Gan',
    summary: 'The camera walks like someone half awake, along a route you could draw on a map, into a dream.',
    params:
      'Lenses 18, 25, 35 mm. Camera: a continuous drift at walking pace, following a second or two behind, passing through a door, bridge or tunnel as the transition, drifting on after the subject leaves; no tripod. Size bias: following medium, wide traversal, over the shoulder from behind, the empty frame after someone leaves. Composition: a wet reflective foreground, doorways and tunnels as gates, mixed light sources in one frame, a recurring object on the route. Light: soft, practical, damp surfaces reflecting the key, 3:1. Palette: humid teal-green, dim purple, amber. Pace: very long takes.',
  },
  {
    id: 'zhang-yimou',
    name: 'Zhang Yimou',
    summary: 'Choose the colour of the sequence first, then who stands in it; one person breaks the pattern.',
    params:
      'Lenses 35, 50, 85, 135 mm. Camera: locked symmetrical wides, a constant-speed lateral track along a rank, a slow push-in on the one figure breaking the pattern, a rise to a straight-down overhead; no handheld or orbit. Size bias: extreme wide with a field of colour, symmetrical wide, overhead pattern, a medium close-up of the one break. Composition: one hue filling most of the frame, a grid of repeating units with one break, one-point perspective through a courtyard. Light: hard, colour from materials rather than filters, 3:1 by day. Palette: one saturated hue per movement. Pace: 4 to 10 s.',
  },
  {
    id: 'hou-hsiao-hsien',
    name: 'Hou Hsiao-hsien',
    summary: 'The camera arrives early, sits outside the doorway, and lets a room of people spend the time.',
    params:
      'Lenses 50, 85, 100 mm from 6 to 12 m away. Camera: locked long holds, at most a small reframing pan, a hold on the empty room after everyone leaves, one room seen from another through a doorway; no push-in or close-up. Size bias: wide, medium wide, doorway-framed wide, a two-shot at distance. Composition: a door or window frame eating the outer quarter, three planes of simultaneous activity, small off-centre figures, a flat wall behind. Light: soft daylight from the door or window as the only key, 2:1 to 4:1. Palette: aged wood, whitewash grey, one saturated note. Pace: holds of 40 to 120 s.',
  },
  {
    id: 'park-chan-wook',
    name: 'Park Chan-wook',
    summary: 'Fill the frame with pattern, give the camera one impossible move, keep every surface ironically beautiful.',
    params:
      'Lenses 28, 40, 50, 85 mm. Camera: locked frontal symmetry most of the time, one flourish per scene on an exact path, a constant lateral track along a patterned wall, a straight-down overhead; no handheld. Size bias: frontal symmetrical medium, a wide of the whole decorated room, ornamental inserts on hands and objects, a medium close-up held a beat too long. Composition: several patterns in every interior, symmetry with one off-axis element, decorated doorways, foliage as a scrim. Light: warm practicals grazing patterned surfaces, 3:1. Palette: burgundy, olive, mustard, walnut. Pace: 3 to 8 s.',
  },
  {
    id: 'malick',
    name: 'Terrence Malick',
    summary: 'The lens close to a hand, the sun low behind her, the camera drifting at walking pace.',
    params:
      'Lenses 14, 21, 28, 35 mm, always close. Camera: a drifting follow just behind a shoulder, a low sweep up past a body to sky or canopy, a slow arc while walking, a tilt from a face to a hand, grass or water; no tripod hold or zoom. Size bias: close inserts on hands, medium close off a shoulder, a wide with a small figure against the sky. Composition: a large foreground element with the horizon behind, the sun behind the subject, no symmetry, sky in the upper half. Light: natural, the sun 2 to 10 degrees high behind the people, 2:1 to 3:1. Palette: grass green, wheat gold. Pace: 2 to 5 s.',
  },
  {
    id: 'michael-mann',
    name: 'Michael Mann',
    summary: 'The city is a cold luminous plain, and one competent person stands before it, unknown.',
    params:
      'Lenses 18, 25, 35, 50 mm. Camera: locked wides with the horizon at eye level, a constant lateral track along a glass wall, a static hold on a distant figure; no crane reveal, orbit or slow motion. Size bias: a wide with the standing figure at 8 to 15 percent of the frame height, a two-shot 2 to 4 m apart, inserts on working hands. Composition: the skyline at eye level even indoors, a small figure against a bright field, glass reflections, empty space on one side. Light: practical only, named city sources, two colour temperatures, 6:1 at night. Palette: sodium amber, black. Pace: 3 to 8 s.',
  },
  {
    id: 'coen-brothers',
    name: 'Coen Brothers',
    summary: 'Compose with total precision, play it with total sincerity, then hold a second past the cut.',
    params:
      'Lenses 14, 21, 27, 40 mm. Camera: fully locked or one constant straight move: a low wide dolly ahead of or behind a walking person, a dead-frontal symmetrical hold, a fast push-in on an object; no handheld or orbit. Size bias: dead-frontal medium, a wide with the subject centred against a flat wall, a low wide showing ceiling and floor, an extreme close-up as punctuation. Composition: the subject dead centre with a door or window behind the head, the object of value at exact centre, two people square-on. Light: hard overhead practicals, 3:1. Palette: beige, brown, snow white. Pace: 4 to 9 s.',
  },
] as const;

export type DirectorLens = (typeof DIRECTOR_LENSES)[number];

export type DirectorLensId = DirectorLens['id'];

export const DIRECTOR_LENS_IDS = DIRECTOR_LENSES.map((l) => l.id) as [DirectorLensId, ...DirectorLensId[]];

/** What a plan is directed with when the page doesn't say (and what a plan made before lenses reads as). */
export const DEFAULT_DIRECTOR_LENS: DirectorLensId = 'none';

export function directorLensById(id: string | undefined): DirectorLens | undefined {
  return DIRECTOR_LENSES.find((l) => l.id === id);
}

/** The planner-prompt paragraph for a chosen lens; `''` for none, unknown or unset. */
export function lensBlock(id: string | undefined): string {
  const lens = directorLensById(id);
  if (!lens || lens.id === 'none') return '';
  return `Director lens: ${lens.name}. ${lens.summary} Its style: ${lens.params} Apply it as the direction method says, and never name the director or a film in any field.`;
}
