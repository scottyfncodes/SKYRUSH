export const formatRaceTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.---';
  const minutes = Math.floor(seconds / 60);
  const secs = seconds - minutes * 60;
  const whole = Math.floor(secs);
  const millis = Math.floor((secs - whole) * 1000);
  return `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

export const formatSpeedKmh = (metersPerSecond: number): string => `${Math.round(metersPerSecond * 3.6)}`;

export const formatCredits = (credits: number): string => `${Math.round(credits).toLocaleString('en-US')}`;

export const ordinal = (position: number): string => {
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${position}th`;
  switch (position % 10) {
    case 1:
      return `${position}st`;
    case 2:
      return `${position}nd`;
    case 3:
      return `${position}rd`;
    default:
      return `${position}th`;
  }
};
