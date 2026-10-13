# SKYRUSH courses and art direction

Courses are data. Each one is a `CourseSpec` in `src/course/courses.ts`, and its look is a
`CourseTheme` in `src/course/themes.ts`. `createCircuit(id)` turns a spec into the gates, rings,
terrain and metadata the simulation and renderer use. Every course starts facing +Z from its spawn.

## Anatomy of a course

- **Gates**: position, valley floor altitude (`floor`) and height above it (`clearance`). Kinds
  `start`, `finish`, `chicane` (narrower) and `summit` (a hop over high ground).
- **Route and valley**: the spawn, the gates and a short tail form a polyline. The terrain is
  carved flat to the gates' floor within `valleyWidth` of it, blending into the mountains over
  `valleyBlend`. That keeps the racing line clear.
- **Mountains** (`MountainProfile` in `src/course/terrain.ts`): ridged noise above a threshold plus
  rolling hills, shifted by an offset so each course has its own range. `terrace` snaps heights to
  flat-topped steps (Ember Mesa).
- **Sea level** (optional): the water surface is the collision ground (`heightAt`), while the seabed
  (`groundAt`) is still rendered under translucent water. Outside the valley, the minimum-height
  guard fades out on water courses, so a raised gate doesn't leave a plateau standing in the sea.
- **Rings**: six bonus rings, each 10–13 m over the ground or water between two gates.
- **Par time**: set just above the lap of ORBIT, the AI pilot flying the player's starting build.

## Art direction

`CourseTheme` drives everything visual:

| Layer      | What it controls                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------ |
| Sky        | Zenith/horizon/below-horizon gradient, sun disc and glow, procedural drifting clouds (GLSL fbm). |
| Light      | Sun direction, colour and intensity (shadows follow it), hemisphere fill, ambient, exposure.     |
| Atmosphere | Linear fog matched to the horizon so distant terrain melts into the sky.                         |
| Ground     | Palette layers: floor, vegetation patches, rock by height and slope, cliff strata, peaks, beach. |
| Water      | Depth-tinted shallows to deep blue, foam at the shoreline, sun glint and fresnel sky reflection. |
| Props      | Instanced pines, palms, boulders, cacti and shrubs on suitable ground, kept off the racing line. |
| Landmarks  | Themed rock for spires and arches, snow caps on alpine spires, lighthouses on the coast.         |

Props are purely visual and have no collision, so every scatter rule keeps a `routeClearance` from
the racing line. The menu and briefing cards draw an SVG skyline from each course's real terrain and
theme colours (`src/ui/CoursePicker.ts`).

## The courses

| Course         | Theme                        | Notes                                                            |
| -------------- | ---------------------------- | ---------------------------------------------------------------- |
| Caldera Ridge  | Desert canyon, golden hour   | The original circuit; gate layout unchanged.                     |
| Frostline Pass | Alpine pass, crisp morning   | Floors climb from 40 m to the High Pass gate at 370 m.           |
| Coral Coast    | Tropical archipelago, midday | Over water at sea level 0; the Saddle gate hops an island ridge. |
| Ember Mesa     | Red mesas at dusk            | Terraced mountains, low sun ahead at the start, the Ember Arch.  |

## Adding a course

1. Add a `CourseTheme` to `themes.ts` and a `CourseSpec` to `courses.ts`, then append it to
   `COURSES`.
2. Run `npx vitest run src/course`. `courses.test.ts` checks every course: start and finish gates,
   at least 30 m of clearance along every straight between gates, ring heights, a grid that spawns
   above the ground facing the start, and a full AI race with no crashes or missed gates. It also
   checks that par sits just above ORBIT's lap.
3. Adjust the mountain offset or profile if the scenery near the route is too sparse or too tall,
   then look at it in the game.
