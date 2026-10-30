import type { FlightParameters, PerformanceSummary } from '../aircraft/performance';
import type { Activity } from './catalog';
import { withCargo } from './FreeFlightSimulation';

/**
 * How well an aircraft suits an activity, in one honest line. Every number
 * comes from the flight parameters the aircraft actually flies with, so the
 * board can say why a bush plane makes deliveries easy and a racer makes them
 * hard, and the pilot can see what a part change would do.
 */

export type FitRating = 'strong' | 'good' | 'tough';

export interface ActivityFit {
  rating: FitRating;
  text: string;
}

export const FIT_LABELS: Record<FitRating, string> = {
  strong: 'Strong fit',
  good: 'Good fit',
  tough: 'Tough fit',
};

const kmh = (metresPerSecond: number): number => Math.round(metresPerSecond * 3.6);

export const activityFit = (
  activity: Activity,
  params: FlightParameters,
  summary: PerformanceSummary,
): ActivityFit => {
  switch (activity.kind) {
    case 'delivery': {
      const loaded = withCargo(params, activity.cargo.mass);
      const margin = activity.hookSpeedKmh - kmh(loaded.stallSpeed);
      const rating: FitRating = margin >= 70 ? 'strong' : margin >= 35 ? 'good' : 'tough';
      return {
        rating,
        text: `Stalls at ${kmh(loaded.stallSpeed)} km/h with the ${activity.cargo.name.toLowerCase()} aboard; the hook needs under ${activity.hookSpeedKmh}.`,
      };
    }
    case 'show': {
      const roll = summary.rollDegPerSec;
      const rating: FitRating = roll >= 190 ? 'strong' : roll >= 135 ? 'good' : 'tough';
      return {
        rating,
        text:
          rating === 'tough'
            ? `Rolls at ${roll}°/s: loops will be wide and rolls slow.`
            : `Rolls at ${roll}°/s and pitches at ${Math.round((params.pitchRate * 180) / Math.PI)}°/s.`,
      };
    }
    case 'precision': {
      const turning = summary.ratings.turning;
      const stall = summary.stallSpeedKmh;
      const rating: FitRating = turning >= 60 && stall <= 140 ? 'strong' : turning >= 40 ? 'good' : 'tough';
      return {
        rating,
        text: `Turning ${turning}/100, stalls at ${stall} km/h: slow is smooth through narrow gates.`,
      };
    }
    case 'trial':
    case 'race': {
      const top = summary.topSpeedKmh;
      const rating: FitRating = top >= 430 ? 'strong' : top >= 370 ? 'good' : 'tough';
      return { rating, text: `Top speed ${top} km/h, 0–250 in ${summary.accelerationSeconds} s.` };
    }
    case 'explore':
      return params.floats
        ? { rating: 'strong', text: 'Floats: water is a runway, so you can touch down anywhere on it.' }
        : {
            rating: 'good',
            text: `Stalls at ${summary.stallSpeedKmh} km/h: the slower you can fly, the more you see.`,
          };
  }
};

const KIND_PLURALS: Record<Activity['kind'], string> = {
  race: 'Grand Prix',
  trial: 'Time trials',
  precision: 'Precision runs',
  show: 'Air shows',
  delivery: 'Deliveries',
  explore: 'Free flight over water',
};

/**
 * The kinds of flying an aircraft is a strong fit for, judged on one
 * representative activity of each kind, for the hangar's "Shines at" line.
 */
export const strongKinds = (
  activities: readonly Activity[],
  params: FlightParameters,
  summary: PerformanceSummary,
): string[] => {
  const seen = new Set<Activity['kind']>();
  const strong: string[] = [];
  for (const activity of activities) {
    if (seen.has(activity.kind) || activity.kind === 'race') continue;
    seen.add(activity.kind);
    if (activityFit(activity, params, summary).rating === 'strong') strong.push(KIND_PLURALS[activity.kind]);
  }
  return strong;
};
