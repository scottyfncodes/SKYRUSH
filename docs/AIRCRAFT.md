# Aircraft, parts and the hangar

SKYRUSH's aircraft are built from one definition: an **airframe** plus one part in each of six
slots (frame, engine, propeller, wings, tail, gear). That single build drives the 3D model, the
flight parameters, compatibility, prices and unlocks. Paint lives beside it and is never read by
the performance model.

| File                               | What it holds                                                               |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `src/aircraft/parts.ts`            | The catalogue: airframes, parts, stats, compatibility, prices, unlock rules |
| `src/aircraft/build.ts`            | Build validation, compatibility checks, migration from version 1 saves      |
| `src/aircraft/performance.ts`      | Flight parameters, flight-card ratings, build character                     |
| `src/aircraft/paint.ts`            | Swatches, patterns, insignia, livery themes                                 |
| `src/aircraft/setups.ts`           | Curated factory setups per aircraft                                         |
| `src/render/aircraft/airframes.ts` | Silhouettes and attachment sockets per airframe                             |
| `src/render/aircraft/geometry.ts`  | Sculpted bodies, lofted airfoil surfaces, static merging                    |
| `src/render/aircraft/livery.ts`    | Fuselage livery texture, insignia decals, propeller blur disc               |
| `src/render/aircraftModel.ts`      | Assembles the model from a build and its paint                              |

## Art direction

A sunlit, slightly vintage air-race world: warm ivory, deep ink blue, vermilion, sun-faded yellow and
sea glass, with brighter colours kept for identity and rewards. Aircraft read through silhouette
first: each airframe has its own fuselage section, canopy, wing mounting, tail and stance, so a
Mule is never a recoloured Meridian.

Materials: enamel paint (lower roughness on the composite frame), matte doped fabric on every
control surface, bare aluminium cylinder heads and gear legs, rubber tyres, tinted canopy glass
with a pilot inside, and a small prefiltered sky environment so paint and glass catch the light.

Authored details: a race number in a meatball roundel, a registration (`SR-M2·07`), maintenance
stencils by the firewall, exhaust staining behind the stacks, panel lines and rivets that change
with the frame, a radio mast with an aerial wire to the fin, red and green navigation lights, painted
propeller tips, and one small gate mark under the canopy for every race won.

The hangar is a workshop rather than a void: painted concrete with a turntable circle and taxi
line, ink-blue corrugated walls, work lamps, a vermilion tool chest and spare-parts crates, and the
door open on a desert airstrip so the aircraft sits against the sky. The interface follows the same
voice: aircraft names in an italic book serif, technical annotations in monospace, an ivory spec
sheet for the flight card, vermilion only for commitments (Buy, Fit, Race) and sea glass or teal for
improvements.

## Aircraft

| Aircraft     | Archetype     | Price   | Unlock                              | Out of the factory                                                                                       | Character             | Top speed | Stall    |
| ------------ | ------------- | ------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------- | --------- | -------- |
| Meridian M-2 | Sport         | Starter | Starter                             | Factory Frame, Kestrel Inline, Standard Three-Blade, Crescent Tapered, Conventional Tail, Spatted Wheels | Balanced              | 379 km/h  | 126 km/h |
| Wren S-1     | Scout         | 1,800   | Available to purchase               | Factory Frame, Wasp Radial, Coarse Two-Blade, Razor Clipped, Conventional Tail, Spatted Wheels           | Agility               | 414 km/h  | 154 km/h |
| Needle R-7   | Racer         | 3,200   | Finish on the podium once to unlock | Factory Frame, Kestrel Inline, Coarse Two-Blade, Razor Clipped, Butterfly V-Tail, Retractable Gear       | Agility · Speed       | 467 km/h  | 154 km/h |
| Mule B-4     | Bush plane    | 2,200   | Finish 1 race to unlock             | Factory Frame, Kestrel Inline, Four-Blade Climber, Condor High-Lift, Steady Stabiliser, Tundra Tyres     | Stability · Endurance | 333 km/h  | 109 km/h |
| Petrel P-3   | Seaplane      | 2,800   | Finish 3 races to unlock            | Factory Frame, Kestrel Inline, Standard Three-Blade, Condor High-Lift, Conventional Tail, Twin Floats    | Stability · Endurance | 333 km/h  | 104 km/h |
| Bastion C-9  | Heavy cruiser | 4,200   | Finish 2 races to unlock            | Factory Frame, Tandem Twin, Standard Three-Blade, Crescent Tapered, Twin Fin, Retractable Gear           | Stability · Speed     | 397 km/h  | 128 km/h |
| Starling A-3 | Aerobatic     | 3,600   | Earn 8 licence stars                | Fabric Lightweight, Wasp Radial, Four-Blade Climber, Razor Clipped, Conventional Tail, Spatted Wheels    | Agility · Climb       | 364 km/h  | 121 km/h |

Each aircraft keeps its own parts and paint. Buying an aircraft delivers its factory parts; parts
are owned once and can be fitted to any aircraft that accepts them.

The Starling is a biplane (`wingSets: 2`): both wings add their area, mass and drag, so it has a low
stall speed and lots of drag, and its short span and high roll factor give it the fastest roll in the
hangar (320°/s). The model draws the upper wing staggered forward on cabane struts, with N-struts and
flying wires. See [ACTIVITIES.md](ACTIVITIES.md) for licence stars.

## Workshop Special and sections

Every aircraft is built from three fuselage sections: a nose, a cabin and a tail boom. Owning an
aircraft gives you its three sections. The Workshop Special (Kitbash X-1, 1,500 credits, opens after
two races) is a bare jig that takes any nose, cabin and boom you own, so a Needle nose can sit on a
Mule cabin in front of a Bastion boom. The hangar names the result after its parts (for example
"Needle–Mule–Bastion Special").

Sections set more than the look. Each one carries part of its donor aircraft's handling: the nose
leads on cooling and responsiveness, the cabin on mass, drag, roll and toughness, and the boom on
pitch and stability. Which wings, tails, gear and engines fit also comes from the sections, so a
racer boom will not take a twin fin. Swapping a section that rules out a fitted part swaps that part
for one you own that fits, and the hangar lists those knock-on swaps before you commit.

A Special looks bolted together, not built in one piece. Each section keeps most of its own size,
so the skin steps where two aircraft meet, and a bare-metal collar with a rivet row along each edge
covers every splice. It rolls out in the Scrapyard livery, whose **As Salvaged** pattern paints only
the cabin in your colours: a nose or boom from another aircraft keeps that aircraft's factory paint
(its pattern, its cowl colour, its tail surfaces), with the old registration showing faintly through
the overpaint. Primer-green patches and a bare aluminium repair panel complete the look, and a
stamped builder's plate by the cabin door lists the donors, as does the line under the hangar
nameplate (`NOSE NEEDLE R-7 · CABIN MULE B-4 · BOOM BASTION C-9`). Any other pattern paints the
whole aircraft in your colours; the collars stay.

Three sections are not in any showroom. Each rival stakes one in a challenge race (see below).

## Rivals

The Rivals screen lists three named pilots, each with a temperament, a record against you and a
section at stake. Every rival flies a Workshop Special as salvaged, with the section they stake
bolted on, so you can see the prize before you race for it. A challenge is one on one on your selected course against a slightly sharper
version of that pilot, who has a line for the grid and another for the finish.

| Rival          | Callsign | Flies                                  | Stakes            |
| -------------- | -------- | -------------------------------------- | ----------------- |
| Mira Castellan | ORBIT    | Meridian nose and boom, Mule cabin     | Mule Cabin        |
| Dax Reyes      | VANDAL   | Needle nose, Wren cabin, Meridian boom | Needle Nose       |
| Jun Okafor     | LONGSHOT | Meridian nose, Bastion cabin and boom  | Bastion Tail Boom |

Beat them once to win the section; the record keeps counting after that.

## Engine strain

Engines smoke as heat builds. Run one into the red and it blows: a burst of smoke, a bang, and a
limp home on reduced power until it cools. The Thunderpod Twin pulls hardest and blows soonest.

## Parts

Every part names its role, what it is best at and what it costs you. Upgrade paths need the
previous part first: Kestrel Inline → Kestrel Sport → Hornet Supercharged (speed), Kestrel Inline →
Albatross Long-Range (endurance), Coarse Two-Blade → Scimitar Racing, Four-Blade Climber → Wide
Paddle, Crescent Tapered → Swallow Elliptical, Condor High-Lift → Kite Long-Span and Fabric
Lightweight → Composite Shell.

### Frame

| Part               | Role      | Best at                      | Trade-off                      | Price | Unlock                                   | Fits | On the aircraft                                   |
| ------------------ | --------- | ---------------------------- | ------------------------------ | ----- | ---------------------------------------- | ---- | ------------------------------------------------- |
| Factory Frame      | Baseline  | No compromises               | No advantages either           | Free  | Factory                                  | All  | Painted panels with flush rivet lines             |
| Fabric Lightweight | Agility   | Quicker response, lower mass | Less stable, scrapes hurt more | 1,400 | Shop                                     | All  | Fabric rear fuselage with visible rib tapes       |
| Composite Shell    | Agility   | Lightest frame, still tough  | The most expensive frame       | 3,000 | Finish 4 races, after Fabric Lightweight | All  | Clear-coated weave panels and a bare carbon spine |
| Reinforced Frame   | Stability | Steadier and tougher         | Heavier, slower to respond     | 1,500 | Finish 1 race                            | All  | Exposed rivet rows and a steel keel plate         |

### Engine

| Part                 | Role        | Best at                          | Trade-off                              | Price | Unlock                              | Fits                                              | On the aircraft                                    |
| -------------------- | ----------- | -------------------------------- | -------------------------------------- | ----- | ----------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| Kestrel Inline       | All-rounder | Cool running, long boost         | Modest thrust                          | Free  | Factory                             | All                                               | Pointed cowl, three exhaust stacks a side          |
| Kestrel Sport        | Speed       | More thrust than the Kestrel     | Runs warmer, shorter boost             | 1,800 | after Kestrel Inline                | All                                               | Six short ejector stacks a side                    |
| Hornet Supercharged  | Speed       | Highest single-engine thrust     | Hot, heavy, short boost                | 3,200 | Finish 3 races, after Kestrel Sport | All                                               | Supercharger scoop on the cowl, six stacks a side  |
| Albatross Long-Range | Endurance   | Longest, fastest-refilling boost | Lowest peak thrust of the Kestrel line | 1,900 | after Kestrel Inline                | All                                               | Long cowl with flame-damper pipes along the flanks |
| Wasp Radial          | Agility     | Very light, spools fast          | Least thrust                           | 1,300 | Shop                                | All                                               | Ring cowl with exposed cylinder heads              |
| Tandem Twin          | Speed       | Most thrust in the hangar        | Heavy, heats quickly                   | 2,600 | Finish 1 race                       | Meridian, Mule, Petrel, Bastion                   | Two nacelles on the wings and a faired nose        |
| Vantage Pulse Drive  | Boost       | Strongest boost by far           | Very hot, very short boost             | 3,400 | Finish on the podium once           | Meridian, Wren, Needle                            | Banded cowl and two glowing combustor cans         |
| Thunderpod Twin      | Speed       | The biggest thrust you can fit   | Very heavy, runs hot, slow to turn     | 4,600 | Finish 2 races                      | Meridian, Mule, Petrel, Bastion, Workshop Special | Two huge pods on outriggers with intake scoops     |

### Propeller

| Part                 | Role     | Best at                       | Trade-off                     | Price | Unlock                                                       | Fits                                  | On the aircraft                            |
| -------------------- | -------- | ----------------------------- | ----------------------------- | ----- | ------------------------------------------------------------ | ------------------------------------- | ------------------------------------------ |
| Standard Three-Blade | Baseline | Even pull at every speed      | No specialism                 | Free  | Factory                                                      | All                                   | Three blades and a cone spinner            |
| Coarse Two-Blade     | Speed    | Higher top speed              | Slower acceleration and climb | 900   | Shop                                                         | All                                   | Two long blades                            |
| Scimitar Racing      | Speed    | Best top speed                | Weakest low-speed pull        | 2,200 | Score 3,000 style points in one race, after Coarse Two-Blade | Meridian, Wren, Needle                | Swept scimitar blades and a bullet spinner |
| Four-Blade Climber   | Climb    | Strong acceleration and climb | Lower top speed               | 1,000 | Shop                                                         | Meridian, Wren, Mule, Petrel, Bastion | Four wide blades and a dome spinner        |
| Wide Paddle          | Climb    | Most low-speed pull           | Lowest top speed              | 1,300 | Finish 2 races, after Four-Blade Climber                     | Meridian, Mule, Petrel, Bastion       | Large paddle blades                        |

### Wings

| Part               | Role      | Best at                         | Trade-off                       | Price | Unlock                                 | Fits                            | On the aircraft                                          |
| ------------------ | --------- | ------------------------------- | ------------------------------- | ----- | -------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| Crescent Tapered   | Baseline  | Predictable at every speed      | No specialism                   | Free  | Factory                                | All                             | Tapered wing with raked tips                             |
| Razor Clipped      | Racing    | Fast roll, low drag             | High stall speed                | 1,500 | Shop                                   | Meridian, Wren, Needle          | Short span with square clipped tips                      |
| Swallow Elliptical | Refined   | Low drag with good grip         | Expensive, slightly less stable | 2,400 | Finish 2 races, after Crescent Tapered | Meridian, Wren, Needle, Bastion | Elliptical outline with rounded tips                     |
| Condor High-Lift   | Low speed | Lowest stall speed, very stable | Draggy on the straights         | 1,700 | Shop                                   | Meridian, Mule, Petrel, Bastion | Long constant-chord wing with flap tracks and end plates |
| Kite Long-Span     | Endurance | Most lift, holds energy         | Slow roll, heavy                | 2,600 | Finish 3 races, after Condor High-Lift | Mule, Petrel, Bastion           | Very long tapered wing with upturned winglets            |

### Tail

| Part              | Role        | Best at                | Trade-off            | Price | Unlock         | Fits                                  | On the aircraft                  |
| ----------------- | ----------- | ---------------------- | -------------------- | ----- | -------------- | ------------------------------------- | -------------------------------- |
| Conventional Tail | Baseline    | Balanced pitch and yaw | No specialism        | Free  | Factory        | All                                   | Single fin with a rounded rudder |
| Steady Stabiliser | Stability   | Much more stable       | Less nimble in pitch | 900   | Shop           | Meridian, Wren, Mule, Petrel, Bastion | Tall fin and broad tailplane     |
| Twin Fin          | Stability   | Stable with strong yaw | More drag and mass   | 1,200 | Shop           | Meridian, Mule, Petrel, Bastion       | Two oval end-plate fins          |
| Butterfly V-Tail  | Performance | Low drag, sharp pitch  | Barely self-levels   | 1,600 | Finish 2 races | Meridian, Wren, Needle                | Two angled tail surfaces, no fin |

### Gear

| Part             | Role      | Best at                           | Trade-off                 | Price | Unlock         | Fits                                  | On the aircraft                                   |
| ---------------- | --------- | --------------------------------- | ------------------------- | ----- | -------------- | ------------------------------------- | ------------------------------------------------- |
| Spatted Wheels   | Baseline  | Light, modest drag                | No extra toughness        | Free  | Factory        | Meridian, Wren, Needle, Mule, Bastion | Streamlined wheel spats                           |
| Tundra Tyres     | Toughness | Survives harder ground contact    | More drag                 | 800   | Shop           | Meridian, Wren, Mule, Bastion         | Oversized balloon tyres on bent legs              |
| Retractable Gear | Speed     | Almost no drag in flight          | Heavier, a little fragile | 2,000 | Finish 2 races | Meridian, Needle, Bastion             | Legs and doors that fold into the wings in flight |
| Twin Floats      | Toughness | Toughest against water and ground | Heavy and very draggy     | 1,200 | Finish 1 race  | Mule, Petrel                          | Two stepped floats on struts                      |

## What the model shows

Every slot changes geometry: frames change the fuselage finish (fabric ribbing, carbon spine,
rivet rows and a keel plate); engines change the cowl (pointed inline, long cowl with flame-damper
pipes, ring cowl with five exposed cylinders, banded pulse cowl with glowing cans, supercharger
scoop) and the number of exhaust stacks; the twin moves the engines to wing nacelles and gives the
cruiser its glazed nose; propellers change blade count, diameter, shape and spinner; wings change
planform, span and tips (raked, clipped, rounded, end plates, winglets); tails change between a
single fin, a big fin and tailplane, twin end-plate fins and a V-tail; gear changes between spats,
balloon tyres on spring legs, retractable legs that fold into the wings in flight, and floats.

## Progression and economy

There is one currency: race credits (1,500 / 1,000 / 700 / 500 for 1st–4th plus clean, time and
style bonuses). New players start with 2,500 credits and the Meridian. The first races each unlock
something: after one race the Mule, Tandem Twin, Twin Floats and the reinforced frame; after two the
Bastion, the elliptical wing, the V-tail, retractable gear and the paddle propeller; after three the
Petrel, the Hornet and the long-span wing; after four the composite frame. A podium opens the Needle
and the Pulse Drive, and a 3,000-point style run opens the Scimitar propeller. Parts cost 800–3,400
credits and aircraft 1,800–4,200, so most races buy something.

Previewing anything is free. Buying a part fits it to the aircraft you are working on; buying an
aircraft shows a reveal and makes it the one you fly. Revert restores the aircraft to how it was
when you opened the hangar, setups save parts and paint together, and nothing is ever sold or lost.

## Saves

Saves stay in `localStorage` under the original key. Version 2 stores every aircraft's build and
paint, saved setups and which reveals have been seen. Version 1 saves are migrated on load: the
original fuselages become the Meridian, Needle and Bastion, owned parts carry over, the installed
build and livery go onto the matching aircraft, and history and best-time builds are converted
rather than dropped. Anything malformed is repaired slot by slot. Saves made before sections
existed gain each aircraft's own sections on load, and the record against each rival is stored
alongside.
