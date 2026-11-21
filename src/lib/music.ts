/** MIDI ノート番号の範囲（C-1〜G9）。ピアノロールはこの範囲を表示する */
export const MIDI_TONE_MIN = 0;
export const MIDI_TONE_MAX = 127;

export const isToneInMidiRange = (tone: number) => tone >= MIDI_TONE_MIN && tone <= MIDI_TONE_MAX;

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** OpenUtau と同じく MIDI 60 を C4 とする */
export function toneName(tone: number): string {
  return `${NAMES[((tone % 12) + 12) % 12]}${Math.floor(tone / 12) - 1}`;
}

export function isBlackKey(tone: number): boolean {
  return NAMES[((tone % 12) + 12) % 12].includes("#");
}
