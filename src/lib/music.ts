const NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/** OpenUtau と同じく MIDI 60 を C4 とする */
export function toneName(tone: number): string {
  return `${NAMES[((tone % 12) + 12) % 12]}${Math.floor(tone / 12) - 1}`;
}

export function isBlackKey(tone: number): boolean {
  return NAMES[((tone % 12) + 12) % 12].includes("#");
}
