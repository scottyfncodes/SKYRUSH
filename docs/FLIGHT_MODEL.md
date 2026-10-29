# SKYRUSH flight model

The flight model (`src/flight/FlightModel.ts`) is a simcade approximation tuned for readable,
exciting racing rather than physical accuracy. It is deterministic, allocation-free and runs at a
fixed 120 Hz step (`src/core/time.ts` bounds the number of steps per frame so a background tab or a
stall cannot destabilise it).

## Conventions

- Body frame: `+Z` forward, `+Y` up, and `+X` is the pilot's _left_ (a Three.js camera looking
  along `+Z` sees `+X` on the viewer's left). "Right" in the model always means screen-right.
- Inputs: pitch (+ nose up), roll (+ bank screen-right), yaw (+ nose screen-right), throttle 0..1,
  boost and airbrake booleans. Inputs are clamped and NaN-safe.
- Units are SI: metres, seconds, kilograms, newtons.

## Rotation

Control inputs command body rotation rates. Rates approach their target with a first-order lag
(`responsiveness`, per fuselage), so a heavy frame feels deliberate and a Needle feels twitchy.

Authority scales with airspeed:

- below ~stall speed authority fades out and a nose-down term pulls the aircraft into a recovering
  dive;
- far above top speed the controls stiffen slightly;
- a large angle between nose and velocity (sloppy handling) halves pitch and roll authority.

### Assisted steering (assistance above 0%)

Roll input commands a _bank angle_ (`input × 1.25 rad`, about 72°) rather than a roll rate, so
holding the stick never rolls the aircraft inverted; releasing it levels the wings. A banked aircraft
turns about the world up axis at `sin(bank) × 1.15 rad/s`, scaled down at high speed, which keeps
bank and pitch intact while the heading changes. The vertical lift lost to bank is restored in
proportion to the assistance strength, so turns are altitude-neutral, and a small nose-up term is
added while banked. Pitch is soft-limited to ±57° so the aircraft cannot loop; the nose always has
authority back toward level. With the stick centred, pitch settles toward level.

The bank loop is a proportional bank-angle controller feeding the lagged roll rate. Two refinements
keep it precise without slowing turn-in:

- **Bank-rate damping.** The roll-rate target subtracts `damping × current roll rate`, with damping
  sized per build for a damping ratio of 0.85 given the bank gain and the fuselage `responsiveness`
  (capped at 0.8). Quick frames such as the Needle need almost none; the Bastion, whose slower rate
  response used to overshoot the bank target by 5–7% and swing through level on release, gets the
  most. The initial roll response is unchanged because the damping term is zero from rest.
- **Faster roll-out.** While the bank is moving back toward level (stick released, reduced, or the
  first half of a reversal) the bank gain is doubled and the roll-rate limit raised by 50%, so a
  turn stops promptly when the stick is released instead of carrying on while the wings come back.
  Turn-in rate and the 72° bank limit are unchanged.

Default build at 90 m/s, before → after: time to half bank 0.41 s → 0.41 s; full-bank overshoot
1.7% → 0.5%; wings level after releasing a full-bank turn 0.92 s → 0.74 s; heading carried on after
release 0.45 → 0.36 rad. On the Bastion a full left/right reversal now settles in 1.4 s instead of
2.2 s with no overshoot.

### Direct control (assistance at 0%)

Roll input commands a roll rate, a mild coordinated yaw follows bank, and the aircraft self-levels
only when the stick is centred. Pitch is unlimited. AI pilots always fly with 60% assistance.

### Input shaping

The touch stick applies a deadzone of 8% followed by a mild response curve
(`|x| × (0.65 + 0.35 |x|)`), so small thumb movements give fine corrections while full deflection
still commands full roll or pitch. Keyboard axes ramp toward the pressed direction (6/s) so taps stay
gentle, and return to centre at 10/s; a reversal also passes back through centre at the 10/s rate.
Inputs are sampled once per fixed simulation step.

## Translation

Forces per step:

- thrust along the nose: `throttle × engine thrust × prop efficiency × prop curve`, × boost
  multiplier while boosting, × 0.55 while overheated. The propeller curve is
  `max(0.3, 1 + bias × (1 − v / 100 m/s))`: a positive bias (four-blade, paddle) pulls harder at low
  speed and fades at high speed, a negative bias (coarse two-blade, scimitar) trades low-speed pull
  for top speed. The standard three-blade has no bias, so the starter build flies exactly as before;
- drag opposite to velocity: `½ ρ (dragArea + airbrake area) v²`, with `dragArea` the sum of the
  airframe, engine, propeller(s), wing (scaled by the airframe's wing size), tail and gear values;
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

## How parts become parameters

Every number comes from `src/aircraft/parts.ts` through `computeFlightParameters` in
`src/aircraft/performance.ts`; paint is never read. In short:

| Parameter      | Built from                                                                               |
| -------------- | ---------------------------------------------------------------------------------------- |
| mass           | airframe × frame mass factor + engine + propeller(s) + wings × wing scale² + tail + gear |
| drag area      | airframe + engine + propeller(s) + wings × wing scale² + tail + gear                     |
| lift area      | wings × wing scale² (sets stall speed)                                                   |
| thrust, curve  | engine thrust × prop efficiency, prop bias                                               |
| pitch rate     | airframe × tail pitch factor, softened by mass                                           |
| roll rate      | wings × airframe roll factor ÷ √wing scale (big wings damp roll)                         |
| responsiveness | airframe × frame × tail, the product clamped to ±15%                                     |
| stability      | airframe + wings + tail + frame, halved beyond 0.6–1.3, clamped to 0.4–2                 |
| durability     | airframe + frame + gear, halved beyond 0.5–1.4 (scrape tolerance is `9 √durability` m/s) |
| heat, boost    | engine, with the airframe's cooling bonus                                                |

Stability and durability use diminishing returns so stacking the steadiest or toughest parts never
runs away. The hangar's flight card shows ratings measured from these parameters: top speed (thrust
= drag), 0–250 km/h time, steady climb gradient at 200 km/h, coasting deceleration at 320 km/h,
roll rate, turning, stability, stall speed, boost before overheating and scrape tolerance.
