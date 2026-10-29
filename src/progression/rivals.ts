/**
 * The three rival pilots on the circuit: who they are, what they say, and the
 * section each one stakes in a challenge race. Pure data, so the UI, the race and
 * progression can all read it without importing each other.
 */

export interface Rival {
  /** Matches the AI personality id in ai/AiPilot.ts. */
  id: string;
  name: string;
  callsign: string;
  /** One word for the rival card. */
  temperament: string;
  bio: string;
  /** Section id they stake in a challenge (see RIVAL_PRIZES in aircraft/parts.ts). */
  prize: string;
  /** Said on the grid before a race. */
  grid: readonly string[];
  /** Said after beating you. */
  gloat: readonly string[];
  /** Said after losing to you. */
  concede: readonly string[];
}

export const RIVALS: readonly Rival[] = [
  {
    id: 'ai-precision',
    name: 'Mira Castellan',
    callsign: 'ORBIT',
    temperament: 'Precise',
    bio: 'Former survey pilot. Flies the cleanest line on the circuit in a Meridian with a Mule cabin bolted in for the long trips.',
    prize: 'cabin-bush',
    grid: [
      'Clean lines win races. Try one.',
      'I have flown this course forty times. Make it interesting.',
      'Hit your gates. The rest takes care of itself.',
    ],
    gloat: ['Textbook. Come back when yours is too.', 'You were early into every turn. Again.'],
    concede: [
      'Fine. The cabin is yours. Keep the windows clean.',
      'Good line through the last gate. I noticed.',
    ],
  },
  {
    id: 'ai-aggressive',
    name: 'Dax Reyes',
    callsign: 'VANDAL',
    temperament: 'Reckless',
    bio: 'Fastest thing on the coast and he will tell you so. Races a hot-rodded Wren with a Needle nose and a Meridian boom grafted on for bragging rights.',
    prize: 'nose-racer',
    grid: ['Try to keep up this time.', 'I will wave as I go past.', 'Hope you brought spare parts.'],
    gloat: ['Was that your top speed? Cute.', 'Saw you in my mirrors. Briefly.'],
    concede: ['Lucky run. Take the nose, I have three more.', 'Enjoy it. It will not happen twice.'],
  },
  {
    id: 'ai-speed',
    name: 'Jun Okafor',
    callsign: 'LONGSHOT',
    temperament: 'Patient',
    bio: 'Flies a heavy Bastion with a Meridian nose welded on like it is on rails. Never first into a turn, rarely last out of one.',
    prize: 'boom-cruiser',
    grid: [
      'Big wings, long lines. Patience.',
      'I do not need to be first into the turn.',
      'See you at the finish.',
    ],
    gloat: ['Momentum always gets there.', 'You flew hard. I flew long.'],
    concede: [
      'Well flown. The boom is yours. It is steadier than it looks.',
      'You earned that one. I will be back.',
    ],
  },
];

export const RIVAL_IDS: ReadonlySet<string> = new Set(RIVALS.map((rival) => rival.id));

export const getRival = (id: string): Rival | undefined => RIVALS.find((rival) => rival.id === id);

/** A line that changes with the number of meetings, so repeat races do not repeat it. */
export const rivalLine = (lines: readonly string[], meetings: number): string =>
  lines[Math.abs(Math.floor(meetings)) % lines.length] ?? '';
