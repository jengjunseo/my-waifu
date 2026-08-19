import type { WorldSession, WorldSessionConfig, WorldSessionState, WorldTurnResult } from "./types.js";

const MAX_MINUTE_STEP = 60 * 24 * 14;

function cleanList(items: string[], max: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= max) break;
  }
  return output;
}

function mergeList(previous: string[], incoming: string[], max: number): string[] {
  return cleanList([...previous, ...incoming], max).slice(-max);
}

export function createWorldSession(config: WorldSessionConfig, now = new Date().toISOString()): WorldSession {
  return {
    id: crypto.randomUUID(),
    config,
    state: {
      turn: 0,
      minuteOffset: 0,
      location: config.startLocation.trim() || "학원도시 제7학구",
      currentCast: [],
      sceneTone: "대패성제의 소란스러운 일상",
      relationships: [],
      activeThreads: [],
      revealedFacts: [],
      canonDivergences: cleanList([config.ifCondition], 30),
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function cloneWorldState(state: WorldSessionState): WorldSessionState {
  return {
    ...state,
    currentCast: [...state.currentCast],
    relationships: [...state.relationships],
    activeThreads: [...state.activeThreads],
    revealedFacts: [...state.revealedFacts],
    canonDivergences: [...state.canonDivergences],
  };
}

export function applyWorldTurn(previous: WorldSessionState, patch: WorldTurnResult["state"]): WorldSessionState {
  const elapsed = Number.isFinite(patch.timeElapsedMinutes)
    ? Math.max(0, Math.min(MAX_MINUTE_STEP, Math.round(patch.timeElapsedMinutes)))
    : 0;

  return {
    turn: previous.turn + 1,
    minuteOffset: previous.minuteOffset + elapsed,
    location: patch.location.trim() || previous.location,
    currentCast: cleanList(patch.currentCast, 10),
    sceneTone: patch.sceneTone.trim() || previous.sceneTone,
    relationships: mergeList(previous.relationships, patch.relationshipChanges, 24),
    activeThreads: mergeList(previous.activeThreads, patch.threadChanges, 20),
    revealedFacts: mergeList(previous.revealedFacts, patch.revealedFacts, 36),
    canonDivergences: mergeList(previous.canonDivergences, patch.canonDivergences, 36),
  };
}

export function formatWorldClock(state: WorldSessionState): string {
  const baseMinutes = 8 * 60 + state.minuteOffset;
  const dayOffset = Math.floor(baseMinutes / (24 * 60));
  const minuteOfDay = ((baseMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const day = 19 + dayOffset;
  return `9월 ${day}일 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function restoreWorldState(snapshot: WorldSessionState): WorldSessionState {
  return cloneWorldState(snapshot);
}
