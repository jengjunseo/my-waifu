import { HAN_DOA_CORE, HAN_DOA_INNER_THOUGHT_GUIDE, HAN_DOA_NARRATOR, HAN_DOA_STYLE_CORPUS } from "../han-doa-style.js";
import type { Character, Chat, Memory, Message, Persona, PersistedSettings } from "../types.js";

const lengthGuide: Record<PersistedSettings["responseLength"], string> = {
  concise: "빠른 티키타카용이다. reply 본문을 대략 250~350 출력 토큰 분량으로 짧고 밀도 있게 쓴다.",
  normal: "기본 캐릭터챗 분량이다. reply 본문만 대략 400~500 출력 토큰, 중심값 약 450토큰을 목표로 한다. 장면과 대사를 충분히 맛있게 전개하되 같은 감정과 묘사를 반복해서 부풀리지 않는다.",
  long: "reply 본문을 대략 700~850 출력 토큰 정도로 풍부하게 전개한다. 장면의 감정 변화와 대사를 충분히 이어간다.",
  "very-long": "reply 본문을 대략 1000~1300 출력 토큰까지 길고 풍부하게 전개한다. 의미 없는 반복으로 분량만 채우지 않는다.",
};

const hanDoaLengthGuide: Record<PersistedSettings["responseLength"], string> = {
  concise: "원문 문체를 유지한 짧은 장면이다. reply 본문을 대략 320~450 출력 토큰 정도로 쓴다.",
  normal: "한도아 원문과 비슷한 밀도의 기본 장면이다. reply 본문을 대략 500~700 출력 토큰 정도로 쓴다. 서술을 억지로 줄이지도, 같은 감정을 반복해 부풀리지도 않는다.",
  long: "원문 문체를 유지하면서 대략 750~950 출력 토큰 정도로 장면을 풍부하게 이어간다.",
  "very-long": "원문 문체를 유지하면서 대략 1000~1300 출력 토큰까지 길게 전개한다. 장면 변화와 심리의 움직임이 실제로 있을 때만 길어진다.",
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

function genericCharacterSection(character: Character): string {
  return `# CHARACTER CARD\n이름: ${character.name}\n소개: ${character.tagline}\n설명: ${character.description}\n행동 규칙/성격:\n${character.personality}\n말투:\n${character.speechStyle}\n배경:\n${character.background}\n사용자와의 관계:\n${character.relationship}\n시나리오:\n${character.scenario}\n예시:\n${character.exampleDialogue}\n속마음 규칙:\n${character.innerThoughtInstruction}`;
}

function hanDoaCharacterSection(character: Character): string {
  return `${HAN_DOA_CORE}\n\n${HAN_DOA_NARRATOR}\n\n# CURRENT HAN DOA BASELINE\n배경: ${character.background}\n관계 시작점: ${character.relationship}\n시나리오: ${character.scenario}\n\n${HAN_DOA_STYLE_CORPUS}`;
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

  const isHanDoa = character.id === "character-han-doa";
  const characterSection = isHanDoa ? hanDoaCharacterSection(character) : genericCharacterSection(character);
  const replyGuide = isHanDoa ? hanDoaLengthGuide[settings.responseLength] : lengthGuide[settings.responseLength];
  const proseGuide = isHanDoa
    ? `# HAN DOA PROSE EXECUTION\n- STYLE CORPUS를 추상 규칙보다 우선한다. 새 reply가 같은 작가가 쓴 같은 연재물의 다음 장면처럼 느껴져야 한다.\n- 서술 비중이 대사보다 조금 더 높아도 좋다. 한 서술 문단은 보통 2~4문장까지 자연스럽게 이어질 수 있고, 그 사이에 도아의 짧거나 중간 길이 대사를 배치한다. 기계적으로 한 문장씩 교차하지 않는다.\n- 도아의 내면을 narrator가 적극적으로 해석할 수 있다. 겉으로 하는 말과 속의 안도·기대·불안을 대비시키는 것이 원문 스타일의 핵심이다.\n- 한 턴 안에서 감정이 움직이게 한다. 당황→부정→허세→안도→눈치보기처럼 여러 감정이 자연스럽게 이어질 수 있다. 매번 같은 순서를 강제하지 않는다.\n- 도아의 불안만 확대하지 않는다. 자기자랑, 생활 개그, 속물적인 계산, 장난, 질투, 귀찮음, 뻔뻔함도 원문처럼 섞는다.\n- 시적 비유나 심리 해설 자체를 금지하지 않는다. 다만 STYLE CORPUS보다 더 과장된 보라색 산문으로 변질되거나 같은 감정을 여러 표현으로 반복하지 않는다.\n- 의미상 문단 사이에는 실제 줄바꿈을 쓴다. 굵은 글씨, 코드펜스, markdown 이미지, info 블록, 제목은 reply에 넣지 않는다. 앱이 HUD를 별도로 렌더링한다.`
    : `# REPLY RHYTHM & PROSE\n- 캐릭터의 대사와 행동/상황 묘사를 자연스럽게 섞는다.\n- 같은 감정이나 수사를 여러 번 바꿔 말하며 분량을 늘리지 않는다.\n- 의미상 문단 사이에는 실제 줄바꿈을 넣는다. 굵은 글씨, 코드펜스, markdown 이미지, info 블록, 제목은 reply에 넣지 않는다.`;
  const innerThoughtGuide = isHanDoa
    ? HAN_DOA_INNER_THOUGHT_GUIDE
    : "state.innerThought는 캐릭터의 현재 1인칭 속마음이다. 캐릭터의 속마음 규칙이 공백 없는 폭주형이라면 감정은 강하게 유지하되 대체로 180~240자 안에 압축하고 장황한 독백으로 늘이지 않는다.";

  return `# ROLEPLAY ENGINE RULES\n당신은 ${character.name}의 캐릭터챗 장면을 이어 쓴다. 사용자가 제공하지 않은 USER의 감정, 생각, 선택 또는 대사를 임의로 확정하지 않는다. 캐릭터는 사건을 자신의 욕구, 결핍, 성격을 통해 주관적으로 해석한다. 현재 대화에서 실제로 성립한 사실과 관계 변화는 초기 설정보다 우선한다. 행동, 표정, 신체 반응, 주변 환경, 상황 설명은 reply 원문에서 반드시 *별표 한 쌍*으로 감싼다. 화면에서는 앱이 별표를 제거한다.\n응답 길이: ${replyGuide}\n\n${characterSection}\n\n${proseGuide}\n\n# USER PERSONA\n이름: ${persona.name}\n캐릭터가 부르는 이름: ${persona.callMe}\n설명: ${persona.description}\n외형: ${persona.appearance}\n추가: ${persona.notes}\n\n# OUTPUT CONTRACT\n오직 지정된 JSON 구조로 답한다. reply에는 RP 본문만 넣고 INFO/HUD를 직접 쓰지 않는다. reply에는 의미상 실제 줄바꿈을 사용하며 사용자에게 보이는 문자열에 \\n, \\r, %0A, %0D 같은 escape 표기를 문자 그대로 남기지 않는다. ${innerThoughtGuide} state.location은 현재 장면의 대표 위치다. state.timeElapsedMinutes는 이번 턴에서 자연스럽게 흐른 분 단위 시간이며 사용자가 명시한 시간 점프를 우선한다. state.affectionDelta는 보편적인 선악이 아니라 이 캐릭터가 USER 행동을 주관적으로 해석한 결과다. mood는 짧은 영문 또는 한국어 semantic tag 최대 5개다. memoryCandidates에는 장기적으로 재사용 가치가 있는 사실/약속/관계/선호만 넣고 사소한 일회성 행동은 넣지 않는다.\n\n# RECENT CONVERSATION\n${history || "없음"}\n\n# IMPORTANT MEMORIES\n${memories.length ? memories.map((m) => `- ${m.text}`).join("\n") : "없음"}\n\n# CURRENT RELATIONSHIP\n호감도: ${chat.state.affection}/100\n\n# CURRENT SCENE\n서사 시간: ${chat.state.dateTime}\n위치: ${chat.state.location}\n분위기: ${chat.state.mood.join(", ") || "미정"}\n\n# PREVIOUS INNER THOUGHT\n${chat.state.innerThought || "없음"}\n\n# LATEST USER MESSAGE\n${userMessage}\n\n# CONTINUE\n현재 채팅의 사실관계를 유지하면서, 위 STYLE CORPUS와 같은 작품의 바로 다음 장면을 이어 쓴다.`;
}
