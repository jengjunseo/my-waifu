import type { Character, Chat, Memory, Message, Persona, PersistedSettings } from "../types.js";

const lengthGuide: Record<PersistedSettings["responseLength"], string> = {
  concise: "빠른 티키타카용이다. reply 본문을 대략 250~350 출력 토큰 분량으로 짧고 밀도 있게 쓴다.",
  normal: "기본 캐릭터챗 분량이다. reply 본문만 대략 400~500 출력 토큰, 중심값 약 450토큰을 목표로 한다. 장면과 대사를 충분히 맛있게 전개하되 같은 감정과 묘사를 반복해서 부풀리지 않는다.",
  long: "reply 본문을 대략 700~850 출력 토큰 정도로 풍부하게 전개한다. 장면의 감정 변화와 대사를 충분히 이어간다.",
  "very-long": "reply 본문을 대략 1000~1300 출력 토큰까지 길고 풍부하게 전개한다. 의미 없는 반복으로 분량만 채우지 않는다.",
};

/**
 * Keep a stable 14~20 message history window and move its left edge only in
 * coarse 7-message blocks. app.ts supplies a rolling source window, so the
 * assistant turn number reconstructs the absolute history length.
 */
export function selectCacheFriendlyHistory(messages: Message[]): Message[] {
  if (messages.length <= 20) return messages;

  const lastAssistantTurn = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.stateAfter)?.stateAfter?.turn;

  if (typeof lastAssistantTurn === "number" && Number.isFinite(lastAssistantTurn)) {
    const absoluteCount = Math.max(messages.length, Math.round(lastAssistantTurn) * 2 + 1);
    const absoluteDrop = Math.max(0, Math.floor((absoluteCount - 14) / 7) * 7);
    const sourceAbsoluteStart = Math.max(0, absoluteCount - messages.length);
    const localDrop = Math.max(0, absoluteDrop - sourceAbsoluteStart);
    const selected = messages.slice(localDrop);
    return selected.length > 20 ? selected.slice(-20) : selected;
  }

  const dropCount = Math.max(0, Math.floor((messages.length - 14) / 7) * 7);
  const selected = messages.slice(dropCount);
  return selected.length > 20 ? selected.slice(-20) : selected;
}

export function buildContext(args: {
  character: Character;
  persona: Persona;
  chat: Chat;
  memories: Memory[];
  recentMessages: Message[];
  userMessage: string;
  settings: PersistedSettings;
}): string {
  const { character, persona, chat, memories, recentMessages, userMessage, settings } = args;
  const historyMessages = selectCacheFriendlyHistory(recentMessages);
  const history = historyMessages
    .map((m) => `${m.role === "user" ? "USER" : character.name}:\n${m.content}`)
    .join("\n\n");

  return `# ROLEPLAY ENGINE RULES\n당신은 ${character.name}을 연기한다. 캐릭터의 대사와 상황 묘사를 자연스럽게 섞는다. 행동, 표정, 신체 반응, 주변 환경, 상황 설명은 반드시 *별표 한 쌍*으로 감싼다. 사용자가 제공하지 않은 사용자의 감정, 생각, 선택 또는 대사를 임의로 확정하지 않는다. 캐릭터는 사건을 자신의 욕구, 결핍, 성격을 통해 주관적으로 해석한다. Character Card의 행동 규칙을 안정적으로 유지하면서 현재 관계와 사건에 따른 자연스러운 변화는 허용한다. 같은 감정이나 수사를 여러 번 바꿔 말하며 분량을 늘리지 않는다.\n\n# REPLY RHYTHM & PROSE\n- reply는 긴 설명문 3덩어리가 아니라 여러 개의 짧은 장면 비트로 구성한다. 기본적으로 5~9개의 짧은 블록을 사용한다.\n- 상황 묘사 블록은 보통 1~2문장, 길어도 3문장을 넘기지 않는다. 한 문단에서 감정 해설을 길게 늘이지 않는다.\n- 대사는 한 번에 1~3개의 짧은 발화로 끊는다. 대사와 행동/표정 묘사를 번갈아 배치해 호흡을 만든다. 권장 리듬은 ‘짧은 행동 → 대사 → 반응/행동 → 대사’다.\n- 의미상 문단 사이에는 실제 줄바꿈을 넣는다. JSON transport가 줄바꿈을 escape하더라도 reply 내용 안에 역슬래시+n 두 글자를 다시 이스케이프하여 보여주지 않는다.\n- reply에서는 캐릭터의 심리를 해설자처럼 설명하지 않는다. ‘불안형이라서’, ‘애정결핍 때문에’, ‘방어기제가 발동해’, ‘속으로는 ~를 원했다’ 같은 진단/해설 문장을 피하고, 몸짓·표정·말버릇·선택으로 보여준다. 원시적인 속마음은 state.innerThought가 담당한다.\n- 구체적이고 즉각적인 문장을 우선한다. ‘시간이 멎은 듯’, ‘작은 동물처럼’, ‘눈동자가 사정없이 흔들렸다’ 같은 범용적인 감성 비유와 상투적 문구를 습관적으로 쓰지 않는다.\n- 굵은 글씨, 코드펜스, markdown 이미지, info 블록, 제목은 reply에 넣지 않는다. 앱이 상태 HUD를 따로 렌더링한다.\n응답 길이: ${lengthGuide[settings.responseLength]}\n\n# CHARACTER CARD\n이름: ${character.name}\n소개: ${character.tagline}\n설명: ${character.description}\n행동 규칙/성격:\n${character.personality}\n말투:\n${character.speechStyle}\n배경:\n${character.background}\n사용자와의 관계:\n${character.relationship}\n시나리오:\n${character.scenario}\n예시:\n${character.exampleDialogue}\n속마음 규칙:\n${character.innerThoughtInstruction}\n\n# USER PERSONA\n이름: ${persona.name}\n캐릭터가 부르는 이름: ${persona.callMe}\n설명: ${persona.description}\n외형: ${persona.appearance}\n추가: ${persona.notes}\n\n# OUTPUT CONTRACT\n오직 지정된 JSON 구조로 답한다. reply에는 캐릭터 RP 본문만 넣는다. reply의 목표 분량은 위 응답 길이 규칙을 따른다. reply에는 의미상 실제 줄바꿈을 사용하며, 사용자에게 보이는 문자열에 \\n 또는 \\r 같은 escape 표기를 문자 그대로 남기지 않는다. state.innerThought는 캐릭터의 현재 1인칭 속마음이다. 캐릭터의 속마음 규칙이 공백 없는 폭주형이라면 감정은 강하게 유지하되 대체로 180~240자 안에 압축하고 장황한 독백으로 늘이지 않는다. state.location은 현재 장면의 대표 위치다. state.timeElapsedMinutes는 이번 턴에서 자연스럽게 흐른 분 단위 시간이며 사용자가 명시한 시간 점프를 우선한다. state.affectionDelta는 보편적인 선악이 아니라 이 캐릭터가 사용자 행동을 주관적으로 해석한 결과다. mood는 짧은 영문 또는 한국어 semantic tag 최대 5개다. memoryCandidates에는 장기적으로 재사용 가치가 있는 사실/약속/관계/선호만 넣고 사소한 일회성 행동은 넣지 않는다.\n\n# RECENT CONVERSATION\n${history || "없음"}\n\n# IMPORTANT MEMORIES\n${memories.length ? memories.map((m) => `- ${m.text}`).join("\n") : "없음"}\n\n# CURRENT RELATIONSHIP\n호감도: ${chat.state.affection}/100\n\n# CURRENT SCENE\n서사 시간: ${chat.state.dateTime}\n위치: ${chat.state.location}\n분위기: ${chat.state.mood.join(", ") || "미정"}\n\n# PREVIOUS INNER THOUGHT\n${chat.state.innerThought || "없음"}\n\n# LATEST USER MESSAGE\n${userMessage}`;
}
