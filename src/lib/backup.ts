import type { Character, Chat, Memory, Message, Persona, PersistedSettings } from "../types.js";

export interface BackupData {
  version: 1;
  exportedAt: string;
  characters: Character[];
  personas: Persona[];
  chats: Chat[];
  messages: Message[];
  memories: Memory[];
  settings: PersistedSettings;
}

export function createBackup(input: Omit<BackupData, "version" | "exportedAt">): BackupData {
  return { version: 1, exportedAt: new Date().toISOString(), ...input };
}

export function parseBackup(text: string): BackupData {
  const data = JSON.parse(text) as Partial<BackupData>;
  if (data.version !== 1 || !Array.isArray(data.characters) || !Array.isArray(data.personas) || !Array.isArray(data.chats) || !Array.isArray(data.messages) || !Array.isArray(data.memories) || !data.settings) {
    throw new Error("지원하지 않거나 손상된 Chara 백업 파일입니다.");
  }
  if ((data.settings as unknown as Record<string, unknown>).apiKey) throw new Error("백업 파일에 API Key가 포함되어 있어 가져오기를 거부했습니다.");
  return data as BackupData;
}
