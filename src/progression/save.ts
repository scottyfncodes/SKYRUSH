import { sanitiseProfile, type PlayerProfile } from './profile';

export const SAVE_KEY = 'skyrush.profile.v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadResult {
  profile: PlayerProfile;
  /** True when storage held nothing or something unusable and defaults were used. */
  recovered: boolean;
}

/** In-memory fallback used when localStorage is unavailable (private mode, blocked, etc.). */
export const createMemoryStorage = (): StorageLike => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

export const resolveStorage = (): StorageLike => {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__skyrush_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    // Fall through to memory storage.
  }
  return createMemoryStorage();
};

export const loadProfile = (storage: StorageLike, key = SAVE_KEY): LoadResult => {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { profile: sanitiseProfile(null), recovered: true };
  }
  if (raw === null) return { profile: sanitiseProfile(null), recovered: true };
  try {
    const parsed: unknown = JSON.parse(raw);
    const profile = sanitiseProfile(parsed);
    const recovered = typeof parsed !== 'object' || parsed === null;
    return { profile, recovered };
  } catch {
    return { profile: sanitiseProfile(null), recovered: true };
  }
};

export const saveProfile = (storage: StorageLike, profile: PlayerProfile, key = SAVE_KEY): boolean => {
  try {
    storage.setItem(key, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
};

export const clearProfile = (storage: StorageLike, key = SAVE_KEY): void => {
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
};
