export type Mood = string;

export interface Character {
  id: string;
  name: string;
  tagline: string;
  avatar?: string;
  description: string;
  personality: string;
  speechStyle: string;
  background: string;
  relationship: string;
  scenario: string;
  exampleDialogue: string;
  firstMessage: string;
  innerThoughtInstruction: string;
  stripInnerThoughtWhitespace: boolean;
  initialAffection: number;
  createdAt: string;
  updatedAt: string;
}

export interface Persona {
  id: string;
  name: string;
  callMe: string;
  description: string;
  appearance: string;
  notes: string;
}

export interface ChatState {
  turn: number;
  dateTime: string;
  location: string;
  innerThought: string;
  affection: number;
  mood: Mood[];
}

export interface Chat {
  id: string;
  characterId: string;
  title: string;
  state: ChatState;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  stateBefore?: ChatState;
  stateAfter?: ChatState;
  generatedMemoryIds?: string[];
}

export interface Memory {
  id: string;
  chatId: string;
  text: string;
  type: string;
  importance: number;
  createdAt: string;
  lastUsedAt?: string;
  pinned: boolean;
}

export interface PersistedSettings {
  modelId: string;
  responseLength: "concise" | "normal" | "long" | "very-long";
  rememberApiKey: boolean;
}

export interface RuntimeSettings extends PersistedSettings {
  apiKey: string;
}

export interface ModelTurnResult {
  reply: string;
  state: {
    innerThought: string;
    location: string;
    timeElapsedMinutes: number;
    affectionDelta: number;
    mood: string[];
  };
  memoryCandidates: Array<{
    text: string;
    type: string;
    importance: number;
  }>;
}
