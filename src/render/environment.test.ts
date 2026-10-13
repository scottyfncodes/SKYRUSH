import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { terrainColor } from './environment';
import { CORAL_THEME, FROSTLINE_THEME } from '../course/themes';

describe('terrainColor', () => {
  it('is deterministic', () => {
    const a = terrainColor(FROSTLINE_THEME.terrain, 120, 0.2, 40, 90, null, new Color());
    const b = terrainColor(FROSTLINE_THEME.terrain, 120, 0.2, 40, 90, null, new Color());
    expect(a.equals(b)).toBe(true);
  });

  it('puts snow on high, gentle alpine ground and not in the valley', () => {
    const peak = terrainColor(FROSTLINE_THEME.terrain, 700, 0.05, 10, 10, null, new Color());
    const valley = terrainColor(FROSTLINE_THEME.terrain, 50, 0.05, 10, 10, null, new Color());
    expect(peak.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(0.8);
    expect(valley.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.5);
  });

  it('paints a pale beach at the waterline and green above it on tropical islands', () => {
    const beach = terrainColor(CORAL_THEME.terrain, 1, 0.05, 10, 10, 0, new Color());
    const jungle = terrainColor(CORAL_THEME.terrain, 60, 0.1, 10, 10, 0, new Color());
    expect(beach.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(0.6);
    expect(jungle.g).toBeGreaterThan(jungle.r);
    expect(jungle.g).toBeGreaterThan(jungle.b);
  });
});
