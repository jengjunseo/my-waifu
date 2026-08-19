export type WorldId = "toaru";
export type TimelineAnchor = "daihaseisai-day1";

export interface WorldSessionConfig {
  worldId: WorldId;
  title: string;
  timelineAnchor: TimelineAnchor;
  userName: string;
  userDescription: string;
  ifCondition: string;
  startLocation: string;
}

export interface WorldSessionState {
  turn: number;
  minuteOffset: number;
  location: string;
  currentCast: string[];
  sceneTone: string;
  relationships: string[];
  activeThreads: string[];
  revealedFacts: string[];
  canonDivergences: string[];
}

export interface WorldSession {
  id: string;
  config: WorldSessionConfig;
  state: WorldSessionState;
  createdAt: string;
  updatedAt: string;
}

export interface WorldMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  stateBefore?: WorldSessionState;
  stateAfter?: WorldSessionState;
  generatedMemoryIds?: string[];
}

export interface WorldMemory {
  id: string;
  sessionId: string;
  text: string;
  type: string;
  importance: number;
  pinned: boolean;
  createdAt: string;
}

export interface WorldPersistedSettings {
  id: "world-settings";
  modelId: string;
  responseLength: "concise" | "normal" | "long";
  rememberApiKey: boolean;
}

export interface WorldRuntimeSettings extends WorldPersistedSettings {
  apiKey: string;
}

export interface WorldTurnResult {
  reply: string;
  state: {
    location: string;
    timeElapsedMinutes: number;
    currentCast: string[];
    sceneTone: string;
    relationshipChanges: string[];
    revealedFacts: string[];
    threadChanges: string[];
    canonDivergences: string[];
  };
  memoryCandidates: Array<{
    text: string;
    type: string;
    importance: number;
  }>;
}
