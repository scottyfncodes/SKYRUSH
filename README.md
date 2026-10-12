# SKYRUSH

**Build a machine. Master the course. Earn better parts. Build something faster.**

SKYRUSH is a browser game about building a custom racing aircraft and flying it flat-out through
a gated circuit against three AI pilots. It runs on desktop browsers and on iPhone Safari in
landscape, needs no account or backend, and deploys as a static site to GitHub Pages.

![Main menu](docs/screenshots/main-menu.png)

## Playing

| Screen    | What happens                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| Main menu | Credits, best time, race count. Race, Garage, or Controls & Settings.                                           |
| Garage    | Swap fuselage, engine and wings; apply a livery; compare every stat against the installed build; buy parts.     |
| Briefing  | Circuit facts, the three opponents, the control bindings for your device, assistance and sensitivity settings.  |
| Race      | 3-2-1 countdown, 15 gates through Caldera Ridge, live position, timer, boost and heat, next-gate marker.        |
| Results   | Finishing position, time with penalties, reward breakdown, standings, newly unlocked parts. Race again or tune. |

### Controls

**Desktop**

| Key                 | Action                |
| ------------------- | --------------------- |
| `W` / `↑`           | Nose up (climb)       |
| `S` / `↓`           | Nose down (dive)      |
| `A` `D` / `←` `→`   | Roll left / right     |
| `Q` / `E`           | Yaw left / right      |
| `Shift` (hold)      | Boost                 |
| `Space` (hold)      | Airbrake              |
| `X` / `Ctrl` (hold) | Ease off the throttle |
| `C`                 | Recenter camera       |
| `R`                 | Restart race          |
| `Esc` / `P`         | Pause / resume        |

**iPhone (landscape)**: left virtual stick (left/right banks and turns, up/down pitches), throttle
slider, BOOST and BRAKE hold buttons, and a pause button. Pitch direction can be inverted in settings
on both devices.

With assistance above 0% (the default is 60%), left and right command a bank angle capped at about
72° and the banked aircraft turns by itself, so it can never be rolled inverted; the nose is kept
within about 57° so it cannot loop. Set assistance to 0% for raw rate control on every axis.

### Progression

- You start with 2,500 credits and the Meridian / Kestrel Turbine / Crescent Balanced build.
- Rewards: 1,500 / 1,000 / 700 / 500 credits for 1st–4th, +300 for a clean run (no missed gates,
  no crashes), and up to +600 for beating the 1:45 par time.
- Parts cost 1,500–3,400 credits. The Tandem Twin unlocks after one race, the Bastion frame after
  two, and the Vantage Pulse Drive after a podium finish. Liveries are free.
- Opponent skill ramps up with your wins so the starter aircraft can reach the podium and an
  upgraded one still gets a fight.
- Credits, owned parts, installed build, best time, settings and race history persist in
  `localStorage`; malformed or missing saves fall back to safe defaults.

## Development

```bash
npm ci
npm run dev          # Vite dev server on http://localhost:5173
npm run test         # Vitest unit and gameplay-system tests
npm run test:e2e     # Playwright (builds and previews the production bundle)
npm run check        # typecheck + lint + unit tests + production build
```

Append `?e2e=1` to the URL to enable the test-only harness (`window.__skyrushTest`) used by the
Playwright suite. It is never active in the normal experience.

### Architecture

```
src/
  aircraft/      parts catalogue, build validation, performance derivation
  flight/        simcade flight model (pure, fixed-step, allocation-free)
  course/        procedural terrain, circuit definition, gate plane/bounds validation
  ai/            waypoint-following opponent controller and pilot personalities
  race/          race simulation: countdown, timing, gates, penalties, standings
  progression/   profile, purchases, unlock rules, rewards, validated save/load
  controls/      keyboard + touch input, merged input manager
  camera/        chase camera
  render/        renderer wrapper, world (terrain, sky, gates, landmarks), aircraft model, effects
  audio/         procedural WebAudio engine, boost, gate and UI sounds
  ui/            DOM screens: menu, garage, briefing, HUD, pause, results, overlays
  app/           App state machine, GarageStage, RaceStage
```

Gameplay systems are deterministic and framework-free so they are tested directly with Vitest.
Rendering and DOM are kept out of those modules. The flight model's assumptions are documented in
[docs/FLIGHT_MODEL.md](docs/FLIGHT_MODEL.md).

### Deployment

`.github/workflows/ci.yml` runs typecheck, lint, format check, unit tests, the production build and
the Playwright suite on every pull request. `.github/workflows/deploy.yml` builds and publishes to
GitHub Pages on pushes to `main`. Pages must be configured to use **GitHub Actions** as its source
(Settings → Pages → Build and deployment). The Vite `base` is `/SKYRUSH/` for production builds, so
the site works at `https://<owner>.github.io/SKYRUSH/`.

## Manual testing

See [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md) for the review procedure and the checks that
still need a physical iPhone.
