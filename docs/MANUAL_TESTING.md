# Manual testing

## Review procedure (any machine)

1. `npm ci && npm run dev`, open http://localhost:5173.
2. Main menu → **Garage**. Switch tabs, highlight the Needle and compare the bars against the
   installed build, buy the Razor Compact wings (1,500 cr), confirm the model's wings change and the
   button turns to _Installed_.
3. **Race** → **Start race**. Fly the opening straight with `W/S/A/D`, boost with `Shift` on the
   straight, airbrake with `Space` before gate 3. Deliberately miss a gate to see the +4s penalty
   message; fly into the ground to see the crash, respawn and recenter.
4. `Esc` to pause, change assistance, resume. `R` restarts.
5. Finish the race (or pause → quit). Check the results, rewards and unlocks, then **Race again**.
6. Reload the page: credits, parts, build and best time should persist.

The CI build artefact (`dist/`) can be previewed with `npx vite preview --base /SKYRUSH/` at
http://localhost:4173/SKYRUSH/ to exercise the GitHub Pages subpath.

## Automated coverage

- `npm run test`: Vitest tests over performance, flight, gates, every course (clearance, rings, a
  clean AI race and par), terrain, race, AI, rewards, purchases, course selection and save/load.
- `npm run test:e2e`: Playwright on a desktop Chromium viewport and an iPhone-14-landscape viewport
  (Chromium with touch emulation): launch, garage, part changes, purchase, race entry, keyboard and
  touch flight, pause/restart, a full race via the test harness, results, picking a course from
  the menu and briefing, persistence, malformed saves, and layout/overlap checks for every screen.

## Still needs a physical iPhone

Playwright cannot run WebKit with WebGL in this environment, so the following were verified only in
Chromium with iPhone viewport and touch emulation:

- [ ] Safari landscape with the browser chrome visible: HUD and touch controls respect the safe-area
      insets, nothing is clipped by the home indicator.
- [ ] Virtual stick, throttle slider, BOOST and BRAKE respond to real multi-touch (stick + boost at
      the same time) and release correctly when a finger slides off or a notification interrupts.
- [ ] Audio starts after the first tap (iOS requires a gesture) and mutes from the settings toggle.
- [ ] Frame rate stays smooth on a recent iPhone (shadows are disabled and pixel ratio is capped at
      1.75 on coarse-pointer devices); report the device model if it stutters.
- [ ] The rotate-to-landscape prompt appears in portrait and the race pauses.
- [ ] Each course (especially Frostline Pass's forest and Coral Coast's water) holds a smooth frame
      rate on the device; note the course if one stutters.
- [ ] Add-to-Home-Screen launch works with the Pages subpath.
