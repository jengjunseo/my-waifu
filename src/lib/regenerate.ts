import type { ChatState, Memory } from "../types.js";

export function restoreStateSnapshot(stateBefore: ChatState): ChatState {
  return { ...stateBefore, mood: [...stateBefore.mood] };
}

export function removeGeneratedMemories(memories: Memory[], generatedIds: string[] = []): Memory[] {
  if (!generatedIds.length) return [...memories];
  const removed = new Set(generatedIds);
  return memories.filter((memory) => !removed.has(memory.id));
}
