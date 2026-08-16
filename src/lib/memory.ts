import type { Memory } from "../types.js";

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
}

export function selectMemories(memories: Memory[], query: string, limit = 8): Memory[] {
  const queryWords = words(query);
  const now = Date.now();
  return [...memories]
    .map((memory) => {
      const overlap = [...words(memory.text)].filter((w) => queryWords.has(w)).length;
      const ageDays = Math.max(0, (now - new Date(memory.createdAt).getTime()) / 86_400_000);
      const recency = 1 / (1 + ageDays / 30);
      const score = (memory.pinned ? 10 : 0) + memory.importance * 3 + overlap * 1.5 + recency;
      return { memory, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ memory }) => memory);
}
