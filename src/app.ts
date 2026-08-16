import { createInitialChat, defaultPersona, defaultSettings, demoCharacter } from "./defaults.js";
import type { Character, Chat, ChatState, Memory, Message, Persona, RuntimeSettings } from "./types.js";
import { createBackup, parseBackup } from "./lib/backup.js";
import { buildContext } from "./lib/context.js";
import { loadSnapshot, put, remove, replaceAllData, saveSettings } from "./lib/db.js";
import { generateCharacterTurn } from "./lib/gemini.js";
import { selectMemories } from "./lib/memory.js";
import { parseNarration } from "./lib/narration.js";
import { removeGeneratedMemories, restoreStateSnapshot } from "./lib/regenerate.js";
import { applyModelState } from "./lib/state.js";

const API_KEY_LOCAL = "chara-api-key";
const API_KEY_SESSION = "chara-api-key-session";

type ModalKind = "status" | "settings" | "persona" | "character" | "memories";

let characters: Character[] = [];
let persona: Persona = defaultPersona;
let chats: Chat[] = [];
let messages: Message[] = [];
let memories: Memory[] = [];
let settings: RuntimeSettings = { ...defaultSettings, apiKey: "" };
let activeChatId = "";
let generating = false;
let editingCharacter: Character | null = null;

const $ = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
};

const app = $("#app");
const splash = $("#splash");
const sidebar = $("#sidebar");
const scrim = $("#sidebar-scrim");
const conversationList = $("#conversation-list");
const messagesEl = $("#messages");
const messageScroll = $("#message-scroll");
const inputEl = $("#composer-input") as HTMLTextAreaElement;
const sendButton = $("#send-button") as HTMLButtonElement;
const modalBackdrop = $("#modal-backdrop");
const modal = $("#modal");
const modalBody = $("#modal-body");
const modalTitle = $("#modal-title");
const backupFile = $("#backup-file") as HTMLInputElement;

function cloneState(state: ChatState): ChatState {
  return { ...state, mood: [...state.mood] };
}

function activeChat(): Chat | undefined {
  return chats.find((chat) => chat.id === activeChatId) ?? chats[0];
}

function activeCharacter(): Character | undefined {
  const chat = activeChat();
  return characters.find((character) => character.id === chat?.characterId) ?? characters[0];
}

function activeMessages(): Message[] {
  const chat = activeChat();
  return messages.filter((message) => message.chatId === chat?.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function activeMemories(): Memory[] {
  const chat = activeChat();
  return memories.filter((memory) => memory.chatId === chat?.id);
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function div(className = "", text = ""): HTMLDivElement {
  const node = document.createElement("div");
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(text: string, className = ""): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function createAvatar(character: Character, size: "small" | "large" = "small"): HTMLElement {
  if (character.avatar) {
    const image = document.createElement("img");
    image.src = character.avatar;
    image.alt = "";
    image.className = `avatar avatar-${size}`;
    image.referrerPolicy = "no-referrer";
    return image;
  }
  const fallback = div(`avatar avatar-${size} avatar-fallback`, character.name.slice(0, 1));
  return fallback;
}

function renderRichText(content: string): HTMLElement {
  const root = div("rich-text");
  for (const segment of parseNarration(content)) {
    const span = document.createElement("span");
    span.className = segment.kind;
    span.textContent = segment.text;
    root.append(span);
  }
  return root;
}

function showError(message: string) {
  $("#error-text").textContent = message;
  $("#error-banner").hidden = false;
}

function clearError() {
  $("#error-banner").hidden = true;
  $("#error-text").textContent = "";
}

function openSidebar() {
  sidebar.classList.add("sidebar-open");
  scrim.classList.add("visible");
}

function closeSidebar() {
  sidebar.classList.remove("sidebar-open");
  scrim.classList.remove("visible");
}

function render() {
  const chat = activeChat();
  const character = activeCharacter();
  if (!chat || !character) return;

  $("#header-name").textContent = character.name;
  $("#header-location").textContent = chat.state.location;
  $("#header-affection").textContent = String(chat.state.affection);
  $("#intro-name").textContent = character.name;
  $("#intro-tagline").textContent = character.tagline;
  inputEl.placeholder = `${character.name}에게 메시지...`;

  const headerAvatar = $("#header-avatar");
  headerAvatar.replaceChildren(createAvatar(character, "small"));
  const introAvatar = $("#intro-avatar");
  introAvatar.replaceChildren(createAvatar(character, "large"));

  renderConversationList();
  renderMessages();
}

function renderConversationList() {
  conversationList.replaceChildren();
  for (const chat of [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const character = characters.find((item) => item.id === chat.characterId) ?? characters[0];
    if (!character) continue;
    const item = button("", `conversation-item ${chat.id === activeChatId ? "active" : ""}`);
    item.append(createAvatar(character, "small"));
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = character.name;
    const stamp = document.createElement("small");
    stamp.textContent = formatTime(chat.updatedAt);
    copy.append(name, stamp);
    item.append(copy);
    item.addEventListener("click", () => {
      activeChatId = chat.id;
      closeSidebar();
      render();
    });
    conversationList.append(item);
  }
}

function renderMessages() {
  messagesEl.replaceChildren();
  const character = activeCharacter();
  if (!character) return;
  const list = activeMessages();
  list.forEach((message, index) => {
    if (message.role === "user") {
      const row = div("message-row user-row");
      const bubble = div("user-bubble");
      bubble.append(renderRichText(message.content));
      row.append(bubble);
      messagesEl.append(row);
      return;
    }

    const row = div("message-row assistant-row");
    row.append(createAvatar(character, "small"));
    const content = div("assistant-content");
    content.append(div("assistant-name", character.name));
    content.append(renderRichText(message.content));
    const actions = div("message-actions");
    const copy = button("복사");
    copy.addEventListener("click", () => navigator.clipboard?.writeText(message.content).catch(() => undefined));
    actions.append(copy);
    const isLastAssistant = index === list.length - 1 && message.role === "assistant";
    if (isLastAssistant && list.some((item) => item.role === "user")) {
      const regen = button("↻ 재생성");
      regen.disabled = generating;
      regen.addEventListener("click", () => void regenerateLast());
      actions.append(regen);
    }
    content.append(actions);
    row.append(content);
    messagesEl.append(row);
  });

  if (generating) {
    const row = div("message-row assistant-row typing-row");
    row.append(createAvatar(character, "small"));
    const dots = div("typing-dots");
    dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    row.append(dots);
    messagesEl.append(row);
  }
  requestAnimationFrame(() => { messageScroll.scrollTop = messageScroll.scrollHeight; });
}

async function initialize() {
  try {
    const snapshot = await loadSnapshot();
    characters = snapshot.characters;
    chats = snapshot.chats;
    messages = snapshot.messages;
    memories = snapshot.memories;
    persona = snapshot.personas[0] ?? defaultPersona;

    if (!characters.length) {
      characters = [demoCharacter];
      await put("characters", demoCharacter);
    }
    if (!snapshot.personas.length) await put("personas", defaultPersona);

    if (!chats.length) {
      const chat = createInitialChat(characters[0]);
      chats = [chat];
      await put("chats", chat);
      if (characters[0].firstMessage) {
        const first: Message = {
          id: crypto.randomUUID(), chatId: chat.id, role: "assistant", content: characters[0].firstMessage,
          createdAt: new Date().toISOString(), stateBefore: cloneState(chat.state), stateAfter: cloneState(chat.state),
        };
        messages.push(first);
        await put("messages", first);
      }
    }

    const persisted = snapshot.settings ?? defaultSettings;
    if (!snapshot.settings) await saveSettings(defaultSettings);
    const apiKey = persisted.rememberApiKey ? localStorage.getItem(API_KEY_LOCAL) ?? "" : sessionStorage.getItem(API_KEY_SESSION) ?? "";
    settings = { ...persisted, apiKey };
    activeChatId = chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? "";
  } catch (error) {
    showError(error instanceof Error ? error.message : "로컬 데이터를 불러오지 못했습니다.");
  } finally {
    splash.hidden = true;
    app.hidden = false;
    render();
  }
}

async function createChat(character: Character) {
  const chat = createInitialChat(character);
  await put("chats", chat);
  chats.unshift(chat);
  if (character.firstMessage) {
    const first: Message = {
      id: crypto.randomUUID(), chatId: chat.id, role: "assistant", content: character.firstMessage,
      createdAt: new Date().toISOString(), stateBefore: cloneState(chat.state), stateAfter: cloneState(chat.state),
    };
    messages.push(first);
    await put("messages", first);
  }
  activeChatId = chat.id;
  render();
}

async function sendMessage() {
  const text = inputEl.value.trim();
  const chat = activeChat();
  const character = activeCharacter();
  if (!text || !chat || !character || generating) return;
  if (!settings.apiKey.trim()) {
    showError("Gemini API Key를 먼저 설정해 주세요.");
    openModal("settings");
    return;
  }
  clearError();
  inputEl.value = "";
  resizeComposer();
  const user: Message = { id: crypto.randomUUID(), chatId: chat.id, role: "user", content: text, createdAt: new Date().toISOString() };
  messages.push(user);
  await put("messages", user);
  renderMessages();
  await generateReply(user, chat, character, activeMessages());
}

async function generateReply(userMessage: Message, baseChat: Chat, character: Character, history: Message[]) {
  generating = true;
  renderMessages();
  try {
    const relevant = selectMemories(memories.filter((m) => m.chatId === baseChat.id), userMessage.content, 8);
    const prompt = buildContext({ character, persona, chat: baseChat, memories: relevant, recentMessages: history.filter((m) => m.id !== userMessage.id).slice(-30), userMessage: userMessage.content, settings });
    const result = await generateCharacterTurn(settings.apiKey, settings.modelId, prompt);
    const stateBefore = cloneState(baseChat.state);
    const stateAfter = applyModelState(stateBefore, character, result.state);

    const createdMemories: Memory[] = result.memoryCandidates
      .filter((candidate) => candidate.text.trim().length >= 4 && candidate.importance >= 0.45)
      .map((candidate) => ({ id: crypto.randomUUID(), chatId: baseChat.id, text: candidate.text.trim(), type: candidate.type.trim() || "fact", importance: candidate.importance, createdAt: new Date().toISOString(), pinned: false }));
    for (const memory of createdMemories) await put("memories", memory);
    memories.push(...createdMemories);

    const assistant: Message = {
      id: crypto.randomUUID(), chatId: baseChat.id, role: "assistant", content: result.reply.trim(), createdAt: new Date().toISOString(),
      stateBefore, stateAfter, generatedMemoryIds: createdMemories.map((memory) => memory.id),
    };
    const updatedChat: Chat = { ...baseChat, state: stateAfter, updatedAt: new Date().toISOString() };
    await put("messages", assistant);
    await put("chats", updatedChat);
    messages.push(assistant);
    chats = [updatedChat, ...chats.filter((item) => item.id !== updatedChat.id)];
  } catch (error) {
    showError(error instanceof Error ? error.message : "응답 생성에 실패했습니다.");
  } finally {
    generating = false;
    render();
  }
}

async function regenerateLast() {
  const chat = activeChat();
  const character = activeCharacter();
  if (!chat || !character || generating) return;
  const list = activeMessages();
  const lastAssistantIndex = [...list].map((m) => m.role).lastIndexOf("assistant");
  if (lastAssistantIndex < 0) return;
  const assistant = list[lastAssistantIndex];
  const userMessage = [...list.slice(0, lastAssistantIndex)].reverse().find((message) => message.role === "user");
  if (!userMessage || !assistant.stateBefore) return;

  const restoredChat: Chat = { ...chat, state: restoreStateSnapshot(assistant.stateBefore), updatedAt: new Date().toISOString() };
  for (const memoryId of assistant.generatedMemoryIds ?? []) await remove("memories", memoryId);
  await remove("messages", assistant.id);
  await put("chats", restoredChat);
  messages = messages.filter((message) => message.id !== assistant.id);
  memories = removeGeneratedMemories(memories, assistant.generatedMemoryIds);
  chats = [restoredChat, ...chats.filter((item) => item.id !== restoredChat.id)];
  render();
  await generateReply(userMessage, restoredChat, character, list.filter((message) => message.id !== assistant.id));
}

function resizeComposer() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(160, inputEl.scrollHeight)}px`;
  sendButton.disabled = !inputEl.value.trim() || generating;
}

function openModal(kind: ModalKind) {
  const character = activeCharacter();
  const chat = activeChat();
  if (!character || !chat) return;
  modal.classList.toggle("modal-wide", kind === "character" || kind === "memories");
  modalBody.replaceChildren();
  modalTitle.textContent = { status: "관계와 현재 상태", settings: "설정", persona: "내 Persona", character: "캐릭터", memories: "기억" }[kind];
  if (kind === "status") renderStatusModal(chat);
  if (kind === "settings") renderSettingsModal();
  if (kind === "persona") renderPersonaModal();
  if (kind === "character") renderCharacterModal(editingCharacter ?? character);
  if (kind === "memories") renderMemoryModal();
  modalBackdrop.hidden = false;
}

function closeModal() {
  modalBackdrop.hidden = true;
  modalBody.replaceChildren();
  editingCharacter = null;
}

function makeField(label: string, value: string, multiline = false, tall = false): { wrap: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const caption = document.createElement("span");
  caption.textContent = label;
  const input = multiline ? document.createElement("textarea") : document.createElement("input");
  input.value = value;
  if (tall) input.classList.add("tall");
  wrap.append(caption, input);
  return { wrap, input };
}

function renderStatusModal(chat: Chat) {
  const hero = div("status-hero");
  hero.append(div("", "♥"), Object.assign(document.createElement("strong"), { textContent: String(chat.state.affection) }), Object.assign(document.createElement("span"), { textContent: "/ 100" }));
  modalBody.append(hero);
  const list = document.createElement("dl");
  list.className = "status-list";
  const entries = [
    ["위치", chat.state.location],
    ["서사 시간", formatTime(chat.state.dateTime)],
    ["분위기", chat.state.mood.length ? chat.state.mood.join(" · ") : "아직 정해지지 않음"],
    ["속마음", chat.state.innerThought || "아직 드러난 속마음이 없습니다."],
  ];
  for (const [term, description] of entries) {
    const row = document.createElement("div");
    if (term === "속마음") row.className = "thought-row";
    const dt = document.createElement("dt"); dt.textContent = term;
    const dd = document.createElement("dd"); dd.textContent = description;
    row.append(dt, dd); list.append(row);
  }
  modalBody.append(list);
}

function renderSettingsModal() {
  const key = makeField("Gemini API Key", settings.apiKey);
  (key.input as HTMLInputElement).type = "password";
  (key.input as HTMLInputElement).placeholder = "AIza...";
  const keyNote = document.createElement("small");
  keyNote.textContent = "키는 소스나 JSON 백업에 포함되지 않습니다.";
  key.wrap.append(keyNote);

  const remember = document.createElement("label");
  remember.className = "check-row";
  const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = settings.rememberApiKey;
  const rememberText = document.createElement("span");
  const strong = document.createElement("strong"); strong.textContent = "이 브라우저에 API Key 저장";
  const small = document.createElement("small"); small.textContent = "공용 기기에서는 저장하지 마세요.";
  rememberText.append(strong, small); remember.append(checkbox, rememberText);

  const model = makeField("Model ID", settings.modelId);
  const lengthWrap = document.createElement("label"); lengthWrap.className = "field";
  const lengthLabel = document.createElement("span"); lengthLabel.textContent = "응답 길이";
  const select = document.createElement("select");
  for (const [value, label] of [["concise", "간결"], ["normal", "보통"], ["long", "길게"], ["very-long", "매우 길게"]]) {
    const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = settings.responseLength === value; select.append(option);
  }
  lengthWrap.append(lengthLabel, select);

  const actions = div("backup-actions");
  const exportButton = button("↓ 전체 백업 내보내기"); exportButton.addEventListener("click", exportBackup);
  const importButton = button("↑ 백업 불러오기"); importButton.addEventListener("click", () => backupFile.click());
  actions.append(exportButton, importButton);

  const save = button("저장", "primary-button");
  save.addEventListener("click", async () => {
    settings = { apiKey: key.input.value, rememberApiKey: checkbox.checked, modelId: model.input.value.trim() || defaultSettings.modelId, responseLength: select.value as RuntimeSettings["responseLength"] };
    await saveSettings({ modelId: settings.modelId, responseLength: settings.responseLength, rememberApiKey: settings.rememberApiKey });
    if (settings.rememberApiKey) {
      localStorage.setItem(API_KEY_LOCAL, settings.apiKey);
      sessionStorage.removeItem(API_KEY_SESSION);
    } else {
      localStorage.removeItem(API_KEY_LOCAL);
      sessionStorage.setItem(API_KEY_SESSION, settings.apiKey);
    }
    closeModal();
  });
  modalBody.append(key.wrap, remember, model.wrap, lengthWrap, div("divider"), actions, save);
}

function renderPersonaModal() {
  const name = makeField("이름", persona.name);
  const callMe = makeField("캐릭터가 나를 부르는 이름", persona.callMe);
  const description = makeField("설명", persona.description, true);
  const appearance = makeField("외형", persona.appearance, true);
  const notes = makeField("추가 설정", persona.notes, true);
  const save = button("저장", "primary-button");
  save.addEventListener("click", async () => {
    persona = { ...persona, name: name.input.value, callMe: callMe.input.value, description: description.input.value, appearance: appearance.input.value, notes: notes.input.value };
    await put("personas", persona);
    closeModal();
  });
  modalBody.append(name.wrap, callMe.wrap, description.wrap, appearance.wrap, notes.wrap, save);
}

function renderCharacterModal(character: Character) {
  editingCharacter = character;
  modalBody.replaceChildren();
  const name = makeField("이름", character.name);
  const tagline = makeField("한 줄 소개", character.tagline);
  const avatar = makeField("Avatar URL (선택)", character.avatar ?? "");
  const description = makeField("설명", character.description, true);
  const personality = makeField("성격 / 행동 규칙", character.personality, true, true);
  const speechStyle = makeField("말투", character.speechStyle, true);
  const background = makeField("배경", character.background, true);
  const relationship = makeField("사용자와의 초기 관계", character.relationship, true);
  const scenario = makeField("시나리오", character.scenario, true);
  const examples = makeField("대화 예시", character.exampleDialogue, true);
  const firstMessage = makeField("첫 메시지", character.firstMessage, true);
  const thoughtInstruction = makeField("속마음 지시", character.innerThoughtInstruction, true);
  const affection = makeField("초기 호감도", String(character.initialAffection));
  (affection.input as HTMLInputElement).type = "number";
  (affection.input as HTMLInputElement).min = "0";
  (affection.input as HTMLInputElement).max = "100";

  const whitespace = document.createElement("label"); whitespace.className = "check-row";
  const strip = document.createElement("input"); strip.type = "checkbox"; strip.checked = character.stripInnerThoughtWhitespace;
  const wsText = document.createElement("span");
  const wsStrong = document.createElement("strong"); wsStrong.textContent = "속마음 공백 제거";
  const wsSmall = document.createElement("small"); wsSmall.textContent = "한도아 같은 폭주형 사고 스트림에만 사용합니다.";
  wsText.append(wsStrong, wsSmall); whitespace.append(strip, wsText);

  const actions = div("editor-actions");
  const fresh = button("＋ 새 캐릭터");
  fresh.addEventListener("click", () => {
    const stamp = new Date().toISOString();
    renderCharacterModal({ ...demoCharacter, id: crypto.randomUUID(), name: "새 캐릭터", tagline: "나만의 캐릭터", avatar: "", description: "", personality: "", speechStyle: "", background: "", relationship: "", scenario: "", exampleDialogue: "", firstMessage: "", innerThoughtInstruction: "1인칭의 자연스러운 속마음.", stripInnerThoughtWhitespace: false, initialAffection: 0, createdAt: stamp, updatedAt: stamp });
  });
  const save = button("저장", "primary-button compact");
  save.addEventListener("click", async () => {
    const now = new Date().toISOString();
    const updated: Character = {
      ...character,
      name: name.input.value.trim() || "이름 없는 캐릭터",
      tagline: tagline.input.value,
      avatar: avatar.input.value.trim(),
      description: description.input.value,
      personality: personality.input.value,
      speechStyle: speechStyle.input.value,
      background: background.input.value,
      relationship: relationship.input.value,
      scenario: scenario.input.value,
      exampleDialogue: examples.input.value,
      firstMessage: firstMessage.input.value,
      innerThoughtInstruction: thoughtInstruction.input.value,
      stripInnerThoughtWhitespace: strip.checked,
      initialAffection: Math.max(0, Math.min(100, Number(affection.input.value) || 0)),
      updatedAt: now,
    };
    await put("characters", updated);
    const exists = characters.some((item) => item.id === updated.id);
    characters = exists ? characters.map((item) => item.id === updated.id ? updated : item) : [...characters, updated];
    if (!exists) await createChat(updated);
    closeModal();
    render();
  });
  actions.append(fresh, save);

  modalBody.append(name.wrap, tagline.wrap, avatar.wrap, description.wrap, personality.wrap, speechStyle.wrap, background.wrap, relationship.wrap, scenario.wrap, examples.wrap, firstMessage.wrap, thoughtInstruction.wrap, whitespace, affection.wrap, actions);
}

function renderMemoryModal() {
  modalBody.replaceChildren();
  const character = activeCharacter();
  if (!character) return;
  const heading = div("memory-heading");
  const copy = div();
  const strong = document.createElement("strong"); strong.textContent = `${character.name}의 장기 기억`;
  const p = document.createElement("p"); p.textContent = "AI가 잘못 기억한 내용은 직접 고칠 수 있습니다.";
  copy.append(strong, p);
  const count = document.createElement("span"); count.textContent = `${activeMemories().length}개`;
  heading.append(copy, count); modalBody.append(heading);

  const list = div("memory-list");
  const items = [...activeMemories()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.importance - a.importance);
  if (!items.length) list.append(div("empty-inline", "아직 저장된 장기 기억이 없습니다."));
  for (const memory of items) {
    const item = div("memory-item");
    const text = document.createElement("textarea"); text.value = memory.text;
    const meta = div("memory-meta");
    const label = document.createElement("span"); label.textContent = `${memory.type} · 중요도 ${Math.round(memory.importance * 100)}`;
    const controls = div();
    const pin = button(memory.pinned ? "고정됨" : "고정"); if (memory.pinned) pin.className = "pinned";
    pin.addEventListener("click", async () => { memory.pinned = !memory.pinned; await put("memories", memory); renderMemoryModal(); });
    const save = button("저장"); save.addEventListener("click", async () => { if (!text.value.trim()) return; memory.text = text.value.trim(); await put("memories", memory); });
    const del = button("삭제"); del.addEventListener("click", async () => { await remove("memories", memory.id); memories = memories.filter((item) => item.id !== memory.id); renderMemoryModal(); });
    controls.append(pin, save, del); meta.append(label, controls); item.append(text, meta); list.append(item);
  }
  modalBody.append(list);
}

function exportBackup() {
  const data = createBackup({
    characters,
    personas: [persona],
    chats,
    messages,
    memories,
    settings: { modelId: settings.modelId, responseLength: settings.responseLength, rememberApiKey: settings.rememberApiKey },
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `chara-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file: File) {
  try {
    const data = parseBackup(await file.text());
    await replaceAllData(data);
    characters = data.characters;
    persona = data.personas[0] ?? defaultPersona;
    chats = data.chats;
    messages = data.messages;
    memories = data.memories;
    settings = { ...data.settings, apiKey: settings.apiKey };
    activeChatId = chats[0]?.id ?? "";
    clearError(); closeModal(); render();
  } catch (error) {
    showError(error instanceof Error ? error.message : "백업을 가져오지 못했습니다.");
  }
}

$("#menu-open").addEventListener("click", openSidebar);
$("#sidebar-close").addEventListener("click", closeSidebar);
scrim.addEventListener("click", closeSidebar);
$("#new-chat").addEventListener("click", () => { const character = activeCharacter(); if (character) void createChat(character); closeSidebar(); });
$("#settings-open").addEventListener("click", () => openModal("settings"));
$("#more-open").addEventListener("click", () => openModal("settings"));
$("#persona-open").addEventListener("click", () => openModal("persona"));
$("#character-open").addEventListener("click", () => openModal("character"));
$("#composer-character").addEventListener("click", () => openModal("character"));
$("#status-open").addEventListener("click", () => openModal("status"));
$("#memories-open").addEventListener("click", () => openModal("memories"));
$("#modal-close").addEventListener("click", closeModal);
modalBackdrop.addEventListener("mousedown", (event) => { if (event.target === modalBackdrop) closeModal(); });
$("#error-close").addEventListener("click", clearError);
sendButton.addEventListener("click", () => void sendMessage());
inputEl.addEventListener("input", resizeComposer);
inputEl.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } });
backupFile.addEventListener("change", () => { const file = backupFile.files?.[0]; if (file) void importBackup(file); backupFile.value = ""; });

document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modalBackdrop.hidden) closeModal(); });

void initialize();
