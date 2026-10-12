# SKYRUSH flight model

The flight model (`src/flight/FlightModel.ts`) is a simcade approximation tuned for readable,
exciting racing rather than physical accuracy. It is deterministic, allocation-free and runs at a
fixed 120 Hz step (`src/core/time.ts` bounds the number of steps per frame so a background tab or a
stall cannot destabilise it).

## Conventions

- Body frame: `+X` right, `+Y` up, `+Z` forward. World up is `+Y`.
- Inputs: pitch (+ nose up), roll (+ right wing down), yaw (+ nose right), throttle 0..1, boost and
  airbrake booleans. Inputs are clamped and NaN-safe.
- Units are SI: metres, seconds, kilograms, newtons.

## Rotation

Control inputs command body rotation rates. Rates approach their target with a first-order lag
(`responsiveness`, per fuselage), so a heavy frame feels deliberate and a Needle feels twitchy.

Authority scales with airspeed:

- below ~stall speed authority fades out and a nose-down term pulls the aircraft into a recovering
  dive;
- far above top speed the controls stiffen slightly;
- a large angle between nose and velocity (sloppy handling) halves pitch and roll authority.

Assistance (player adjustable, 0–100%) adds self-levelling in roll and pitch when the stick is
centred, a coordinated-turn yaw when banked, and a little automatic pitch while banked so a rolled
aircraft turns without hauling on the stick.

## Translation

Forces per step:

- thrust along the nose: `throttle × engine thrust`, × boost multiplier while boosting, × 0.55 while
  overheated;
- drag opposite to velocity: `½ ρ (dragArea + airbrake area) v²`, with `dragArea` the sum of the
  fuselage, engine and wing values;
- gravity;
- lift along body-up: `g × min(1, (v / stall speed)²)`. Above stall speed lift exactly cancels
  gravity in level flight, so the aircraft goes where it points; banked or inverted it sinks.

Top speed is therefore `√(thrust / (½ ρ dragArea))` and stall speed is
`√(m g / (½ ρ × 1.4 × liftArea))`; both are shown in the garage.

### Grip (velocity alignment)

After integrating the forces, the velocity direction is rotated toward the nose at a bounded rate
("grip", from the wing set, scaled by `(80 m/s ÷ v)^exponent` and by mass). This gives momentum:
high-speed turns need more room, pulling hard at low speed is sloppy, and the angle between nose and
velocity bleeds energy (`0.45 × angle` per second). High-lift wings keep grip at low speed; compact
wings keep it at high speed.

## Boost and heat

Boost drains a reserve (`boostCapacity` seconds) and recharges while released. Heat relaxes toward an
engine load: `baseLoad × throttle²`, plus `boostLoad` while boosting (which pushes the equilibrium
above 1.0). Heating and cooling use separate rates; the fuselage adds a cooling bonus and the
airbrake adds 30% airflow cooling. Reaching 100% heat sets _overheated_: boost is disabled and
thrust drops until heat falls below 70%. The Kestrel can never overheat from a single boost; the
Tandem Twin overheats after ~3 seconds of continuous boost from a hot engine; the Pulse Drive
rewards short bursts.

## Ground and ceiling

Contact below 1.5 m above the terrain is a _scrape_ (bounce, −20% speed) when the descent rate is
under `9 × √durability` m/s and the nose is not pointed steeply down; otherwise it is a _crash_. The
race layer applies a penalty of `round(3 + 3 ÷ durability)` seconds and respawns the aircraft just
past its last gate, facing the next one, at 62 m/s. A soft ceiling at 900 m damps vertical speed.

## Tuning reference (default build)

| Quantity    | Value    |
| ----------- | -------- |
| Mass        | 1,370 kg |
| Top speed   | 379 km/h |
| Stall speed | 126 km/h |
| 0–250 km/h  | 12.7 s   |
| Boost       | 5.5 s    |

The ideal AI lap on the default build is ~100 s; the circuit par time is 105 s.
