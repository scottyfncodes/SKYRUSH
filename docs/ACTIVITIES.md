# Activities, conditions and the pilot licence

Everything outside the Grand Prix is data in `src/activities/catalog.ts`, simulated by pure,
deterministic code and judged by `src/activities/medals.ts`. Places are given relative to a region's
racing line (`SegmentRef`: `t` of the way from race gate `after` to the next, shifted sideways), so
they always sit in the carved valley; `src/activities/places.ts` resolves them on the terrain.

| File                                 | What it holds                                                           |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `activities/catalog.ts`              | Every activity and discovery, medal targets, conditions                 |
| `activities/conditions.ts`           | Time of day and weather: theme grading, deterministic wind and gusts    |
| `activities/tricks.ts`               | Aerobatic figure detection and chain scoring                            |
| `activities/FreeFlightSimulation.ts` | Air shows, deliveries and free flight (crashes, respawns, discoveries)  |
| `activities/places.ts`               | Precision circuits, delivery stops, show box floor, discovery placement |
| `activities/ghost.ts`                | Lap recording, compact storage, the club ghost                          |
| `activities/fit.ts`                  | How well an aircraft suits an activity, from its flight parameters      |
| `progression/activities.ts`          | Medals, rewards, licence stars and ranks, badges, logbook, suggestions  |
| `app/FreeFlightStage.ts`             | Rendering, camera, HUD and audio for free-flight activities             |
| `render/activityProps.ts`            | Discovery objects, show box pylons, delivery hook masts                 |

Time trials and precision runs reuse `RaceSimulation` with one racer (`strict` ends a precision run on
a miss or crash; per-gate offsets give the accuracy).

## Conditions

`gradeTheme` blends a region's authored sky, sun, fog and exposure toward dawn or dusk palettes and
greys and thickens them for overcast, fog and rain. `sampleWind` returns the air mass velocity from
the steady wind, a slow gust swell that also veers, and (in turbulent weather) vertical bumps, plus a
roll disturbance. The flight model flies relative to the air (`FlightEnvironment.wind`): drag, lift
and grip use airspeed, the position moves with ground speed. With no wind it is bit-for-bit the old
model.

## Flight model additions

- **Aerobatic control** (`FlightAssist.aerobatic`): rate control on every axis like assistance 0%,
  but the wings and nose only self-level within about 63° of upright, so loops and inverted flight
  hold. Every aircraft can loop and roll with it (tested).
- **Floats on water**: with float gear, touching water is a `splash` (planes along the surface,
  no scrape, no combo break) unless the dive is steep.

## Air shows

The tracker integrates the body rates: 331° of pitch with little roll is a loop (negative: outside
loop), 331° of roll is an aileron roll (a barrel roll if the nose also moved a lot), holding past 150°
of bank is an inverted pass and near 90° a knife edge (both pay on exit, more for longer). Figures
inside the box chain within 6 s for a multiplier (+0.5 per figure, ×4 max); the same figure twice in a
row pays half; below 50 m pays ×1.5. Figures outside the box score nothing.

## Deliveries

A hook pass counts inside a 45 m zone below the activity's height and speed limits; the HUD says why
a pass was refused. Cargo adds mass (stall speed rises with √mass, response falls). Banking past the
cargo's limit, hauling on the stick, scrapes and crashes cost condition; at 0% the cargo is lost.
Medals need both the time and the condition.

## Discoveries

Five per region. Fly within 130 m (and under 170 m above) to find one; a trail is found by flying
through all five of its rings, which only appear within 650 m. Free flight shows the distance to the
nearest unfound thing within 900 m. Discoveries found on any non-race flight are logged.

## Medal targets

Trial medals bracket the club ghost (ORBIT flying the starter Meridian at 94% skill, between silver
and bronze); gold needs an upgraded aircraft flown hard. Delivery times were set from an autopilot
flying each route along the valley. Tests in `src/activities/*.test.ts` fly these with the real flight
model so retuning a part never silently makes an activity impossible.
