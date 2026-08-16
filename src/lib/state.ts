import type { Character, ChatState } from "../types.js";

export function clampAffection(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function applyAffectionDelta(current: number, delta: number): number {
  return clampAffection(current + delta);
}

export function advanceNarrativeTime(iso: string, elapsedMinutes: number): string {
  const base = new Date(iso);
  const safeMinutes = Number.isFinite(elapsedMinutes) ? Math.max(0, Math.min(60 * 24 * 365, elapsedMinutes)) : 0;
  return new Date(base.getTime() + safeMinutes * 60_000).toISOString();
}

export function normalizeInnerThought(character: Character, thought: string): string {
  const trimmed = thought.trim();
  return character.stripInnerThoughtWhitespace ? trimmed.replace(/\s+/g, "") : trimmed;
}

export function applyModelState(
  previous: ChatState,
  character: Character,
  patch: {
    innerThought: string;
    location: string;
    timeElapsedMinutes: number;
    affectionDelta: number;
    mood: string[];
  },
): ChatState {
  return {
    turn: previous.turn + 1,
    dateTime: advanceNarrativeTime(previous.dateTime, patch.timeElapsedMinutes),
    location: patch.location.trim() || previous.location,
    innerThought: normalizeInnerThought(character, patch.innerThought),
    affection: applyAffectionDelta(previous.affection, patch.affectionDelta),
    mood: patch.mood.map((m) => m.trim()).filter(Boolean).slice(0, 5),
  };
}
