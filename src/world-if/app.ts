import { parseNarration } from "../lib/narration.js";
import { buildWorldContext } from "./context.js";
import { loadSharedCharaContext, loadWorldSnapshot, saveWorldSettings, worldPut, worldRemove } from "./db.js";
import { generateWorldTurn } from "./gemini.js";
import { applyWorldTurn, cloneWorldState, createWorldSession, formatWorldClock, restoreWorldState } from "./state.js";
import type { WorldMemory, WorldMessage, WorldPersistedSettings, WorldRuntimeSettings, WorldSession, WorldSessionConfig } from "./types.js";

const API_KEY_LOCAL = "chara-api-key";
const API_KEY_SESSION = "chara-api-key-session";
let sessions: WorldSession[] = [];
let messages: WorldMessage[] = [];
let memories: WorldMemory[] = [];
let settings: WorldRuntimeSettings = { id: "world-settings", modelId: "gemini-3.5-flash", responseLength: "normal", rememberApiKey: true, apiKey: "" };
let activeSessionId = "";
let generating = false;
let streamedReply = "";
let sharedPersonaName = "USER";
let sharedPersonaDescription = "";

const $ = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing World IF element: ${selector}`);
  return node;
};
const app = $("#world-app");
const sessionList = $("#world-session-list");
const main = $("#world-main");
const composer = $("#world-composer") as HTMLTextAreaElement;
const sendButton = $("#world-send") as HTMLButtonElement;
const errorBanner = $("#world-error");
const errorText = $("#world-error-text");
const settingsOverlay = $("#world-settings-overlay");
const settingsBody = $("#world-settings-body");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function button(text: string, className = "") { const b = el("button", className, text); b.type = "button"; return b; }
function field(label: string, value = "", multiline = false) {
  const wrap = el("label", "world-field");
  const input = multiline ? el("textarea") : el("input");
  input.value = value;
  wrap.append(el("span", "", label), input);
  return { wrap, input };
}
function activeSession() { return sessions.find((s) => s.id === activeSessionId) ?? sessions[0]; }
function activeMessages() {
  const id = activeSession()?.id;
  return messages.filter((m) => m.sessionId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
function activeMemories() { const id = activeSession()?.id; return memories.filter((m) => m.sessionId === id); }
function clearError() { errorBanner.hidden = true; errorText.textContent = ""; }
function showError(message: string) { errorText.textContent = message; errorBanner.hidden = false; }
function rich(content: string) {
  const root = el("div", "world-rich-text");
  for (const segment of parseNarration(content)) {
    const span = el("span", `world-${segment.kind}`);
    span.textContent = segment.text;
    root.append(span);
  }
  return root;
}

function renderSessions() {
  sessionList.replaceChildren();
  const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!sorted.length) sessionList.append(el("div", "world-empty-side", "아직 IF가 없습니다."));
  for (const session of sorted) {
    const item = button("", `world-session-item ${session.id === activeSessionId ? "active" : ""}`);
    const copy = el("span", "world-session-copy");
    copy.append(el("strong", "", session.config.title), el("small", "", `${formatWorldClock(session.state)} · ${session.state.location}`));
    item.append(el("span", "world-session-mark", "IF"), copy);
    item.addEventListener("click", () => {
      activeSessionId = session.id;
      history.replaceState(null, "", `/world.html?session=${encodeURIComponent(session.id)}`);
      render();
    });
    sessionList.append(item);
  }
}

function renderHud(session: WorldSession) {
  const hud = el("div", "world-hud");
  const rows: Array<[string, string]> = [
    ["⏳", `[${session.state.turn}]`], ["📆", formatWorldClock(session.state)], ["📍", session.state.location],
    ["♟", session.state.currentCast.length ? session.state.currentCast.join(" · ") : "장면 진입 전"],
  ];
  for (const [icon, text] of rows) {
    const cell = el("div", "world-hud-cell"); cell.append(el("span", "world-hud-icon", icon), el("span", "", text)); hud.append(cell);
  }
  return hud;
}
function renderState(session: WorldSession) {
  const details = el("details", "world-state-details"); details.append(el("summary", "", "현재 IF 상태 · 실마리 / divergence"));
  const sections: Array<[string, string[]]> = [["관계 변화", session.state.relationships], ["활성 실마리", session.state.activeThreads], ["공개된 사실", session.state.revealedFacts], ["Canon Divergence", session.state.canonDivergences]];
  for (const [title, items] of sections) {
    const section = el("section", "world-state-block"); section.append(el("h3", "", title));
    if (!items.length) section.append(el("p", "world-muted", "없음"));
    else { const ul = el("ul"); items.forEach((x) => ul.append(el("li", "", x))); section.append(ul); }
    details.append(section);
  }
  return details;
}
function renderMessageList(session: WorldSession) {
  const list = $("#world-messages"); list.replaceChildren();
  for (const message of activeMessages()) {
    const row = el("article", `world-message ${message.role}`);
    if (message.role === "assistant") row.append(el("div", "world-speaker", "WORLD IF"));
    row.append(rich(message.content)); list.append(row);
  }
  if (generating) {
    const row = el("article", "world-message assistant streaming"); row.append(el("div", "world-speaker", "WORLD IF"));
    row.append(streamedReply ? rich(streamedReply) : el("div", "world-typing", "세계가 다음 장면을 계산하는 중…")); list.append(row);
  }
  requestAnimationFrame(() => { const scroll = $("#world-scroll"); scroll.scrollTop = scroll.scrollHeight; });
  sendButton.disabled = generating || !composer.value.trim();
  composer.placeholder = `${session.config.userName}의 행동이나 대사를 입력…`;
}
function renderChat(session: WorldSession) {
  main.replaceChildren();
  const header = el("header", "world-chat-header");
  const left = el("div"); left.append(el("div", "world-eyebrow", "WORLD IF · 어떤 마술의 금서목록"), el("h1", "", session.config.title), el("p", "", session.config.ifCondition));
  const actions = el("div", "world-header-actions");
  const regen = button("↻ 마지막 재생성"); regen.disabled = generating || !activeMessages().some((m) => m.role === "assistant"); regen.addEventListener("click", () => void regenerateLast());
  const fresh = button("＋ 새 IF", "world-secondary"); fresh.addEventListener("click", renderSetup); actions.append(regen, fresh); header.append(left, actions);
  main.append(header, renderHud(session), renderState(session));
  const scroll = el("section", "world-scroll"); scroll.id = "world-scroll";
  const intro = el("div", "world-intro"); intro.append(el("span", "world-intro-badge", "TOARU"), el("h2", "", "세계는 원작을 기억하지만, 결과는 당신을 따라 갈라진다."), el("p", "", "NPC는 자기 성격·지식·목적대로 움직입니다. 원작 사건은 강제 레일이 아니라 배경 압력입니다."));
  const root = el("div", "world-messages"); root.id = "world-messages"; scroll.append(intro, root); main.append(scroll);
  const zone = el("div", "world-composer-zone"), shell = el("div", "world-composer-shell"); shell.append(composer, sendButton); zone.append(shell, el("small", "", "Enter 전송 · Shift+Enter 줄바꿈 · USER의 행동/대사만 입력")); main.append(zone);
  renderMessageList(session);
}

function renderSetup() {
  activeSessionId = ""; history.replaceState(null, "", "/world.html"); main.replaceChildren();
  const wrap = el("div", "world-setup"); wrap.append(el("div", "world-eyebrow", "WORLD IF v1"), el("h1", "", "새로운 어마금 IF 시작"), el("p", "world-lead", "한 가지 새로운 변수를 학원도시에 넣습니다. 나머지는 캐릭터와 세계가 스스로 굴러갑니다."));
  const grid = el("div", "world-setup-grid");
  const world = field("World", "어떤 마술의 금서목록"), timeline = field("Timeline", "9월 19일 · 대패성제 첫날"), name = field("내 이름 / OC", sharedPersonaName), start = field("시작 위치", "학원도시 제7학구"), description = field("내 설정", sharedPersonaDescription, true), condition = field("이 세계에서 달라진 단 하나의 IF 조건", "학원도시에 정체불명의 새 학생이 전입했다.", true);
  world.input.setAttribute("readonly", "true"); timeline.input.setAttribute("readonly", "true"); grid.append(world.wrap, timeline.wrap, name.wrap, start.wrap, description.wrap, condition.wrap); wrap.append(grid);
  const launch = button("이 IF 시작", "world-primary");
  launch.addEventListener("click", async () => {
    const config: WorldSessionConfig = { worldId: "toaru", title: `${name.input.value.trim() || "새 OC"} · 대패성제 IF`, timelineAnchor: "daihaseisai-day1", userName: name.input.value.trim() || "USER", userDescription: description.input.value.trim(), ifCondition: condition.input.value.trim(), startLocation: start.input.value.trim() || "학원도시 제7학구" };
    if (!config.ifCondition) { showError("IF 조건을 한 줄 이상 입력해 주세요."); return; }
    const session = createWorldSession(config); await worldPut("sessions", session); sessions.unshift(session); activeSessionId = session.id; history.replaceState(null, "", `/world.html?session=${encodeURIComponent(session.id)}`); clearError(); render();
  });
  wrap.append(launch); main.append(wrap);
}
function render() { renderSessions(); const session = activeSession(); if (session) renderChat(session); else renderSetup(); }

function selectedMemories(query: string) {
  const terms = query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 2);
  return activeMemories().map((memory) => ({ memory, score: Number(memory.pinned) * 10 + memory.importance * 3 + terms.reduce((n, t) => n + Number(memory.text.toLocaleLowerCase().includes(t)), 0) })).sort((a, b) => b.score - a.score).slice(0, 10).map((x) => x.memory);
}
async function generateReply(user: WorldMessage, base: WorldSession, historyMessages: WorldMessage[]) {
  generating = true; streamedReply = ""; renderChat(base);
  try {
    const prompt = buildWorldContext({ session: base, recentMessages: historyMessages.filter((m) => m.id !== user.id), memories: selectedMemories(user.content), userMessage: user.content, settings });
    const result = await generateWorldTurn(settings.apiKey, settings.modelId, prompt); const before = cloneWorldState(base.state), after = applyWorldTurn(before, result.state);
    const created: WorldMemory[] = result.memoryCandidates.filter((x) => x.importance >= .45).map((x) => ({ id: crypto.randomUUID(), sessionId: base.id, text: x.text, type: x.type || "fact", importance: x.importance, pinned: false, createdAt: new Date().toISOString() }));
    for (const m of created) await worldPut("memories", m); memories.push(...created);
    const assistant: WorldMessage = { id: crypto.randomUUID(), sessionId: base.id, role: "assistant", content: result.reply, createdAt: new Date().toISOString(), stateBefore: before, stateAfter: after, generatedMemoryIds: created.map((m) => m.id) };
    const updated: WorldSession = { ...base, state: after, updatedAt: new Date().toISOString() };
    await worldPut("messages", assistant); await worldPut("sessions", updated); messages.push(assistant); sessions = [updated, ...sessions.filter((s) => s.id !== updated.id)]; activeSessionId = updated.id;
  } catch (error) { showError(error instanceof Error ? error.message : "World IF 응답 생성에 실패했습니다."); }
  finally { generating = false; streamedReply = ""; render(); }
}
async function send() {
  const text = composer.value.trim(), session = activeSession(); if (!text || !session || generating) return;
  if (!settings.apiKey.trim()) { openSettings(); showError("Gemini API Key를 먼저 설정해 주세요."); return; }
  clearError(); composer.value = "";
  const user: WorldMessage = { id: crypto.randomUUID(), sessionId: session.id, role: "user", content: text, createdAt: new Date().toISOString() }; messages.push(user); await worldPut("messages", user); renderChat(session); await generateReply(user, session, activeMessages());
}
async function regenerateLast() {
  const session = activeSession(); if (!session || generating) return; const list = activeMessages(), index = [...list].map((m) => m.role).lastIndexOf("assistant"); if (index < 0) return;
  const assistant = list[index], user = [...list.slice(0, index)].reverse().find((m) => m.role === "user"); if (!user || !assistant.stateBefore) return;
  const restored: WorldSession = { ...session, state: restoreWorldState(assistant.stateBefore), updatedAt: new Date().toISOString() };
  for (const id of assistant.generatedMemoryIds ?? []) await worldRemove("memories", id); await worldRemove("messages", assistant.id); await worldPut("sessions", restored);
  memories = memories.filter((m) => !(assistant.generatedMemoryIds ?? []).includes(m.id)); messages = messages.filter((m) => m.id !== assistant.id); sessions = [restored, ...sessions.filter((s) => s.id !== restored.id)]; render(); await generateReply(user, restored, list.filter((m) => m.id !== assistant.id));
}

function openSettings() {
  settingsBody.replaceChildren(); const key = field("Gemini API Key", settings.apiKey), model = field("Model ID", settings.modelId); (key.input as HTMLInputElement).type = "password"; (key.input as HTMLInputElement).placeholder = "AIza...";
  const length = el("label", "world-field"), select = el("select"); length.append(el("span", "", "응답 길이"));
  ([["concise","간결"],["normal","보통"],["long","길게"]] as const).forEach(([value, label]) => { const option = el("option", "", label); option.value = value; option.selected = settings.responseLength === value; select.append(option); }); length.append(select);
  const remember = el("label", "world-check"), checkbox = el("input") as HTMLInputElement; checkbox.type = "checkbox"; checkbox.checked = settings.rememberApiKey; remember.append(checkbox, el("span", "", "이 브라우저에 API Key 저장"));
  const save = button("저장", "world-primary"); save.addEventListener("click", async () => {
    settings = { id: "world-settings", modelId: model.input.value.trim() || "gemini-3.5-flash", responseLength: select.value as WorldRuntimeSettings["responseLength"], rememberApiKey: checkbox.checked, apiKey: key.input.value.trim() };
    const persisted: WorldPersistedSettings = { id: "world-settings", modelId: settings.modelId, responseLength: settings.responseLength, rememberApiKey: settings.rememberApiKey }; await saveWorldSettings(persisted);
    if (settings.rememberApiKey) { localStorage.setItem(API_KEY_LOCAL, settings.apiKey); sessionStorage.removeItem(API_KEY_SESSION); } else { localStorage.removeItem(API_KEY_LOCAL); sessionStorage.setItem(API_KEY_SESSION, settings.apiKey); }
    settingsOverlay.hidden = true; clearError();
  }); settingsBody.append(key.wrap, model.wrap, length, remember, save); settingsOverlay.hidden = false;
}
async function initialize() {
  try {
    const [snapshot, shared] = await Promise.all([loadWorldSnapshot(), loadSharedCharaContext()]); sessions = snapshot.sessions; messages = snapshot.messages; memories = snapshot.memories;
    sharedPersonaName = shared.persona?.callMe || shared.persona?.name || "USER"; sharedPersonaDescription = [shared.persona?.description, shared.persona?.appearance ? `외형: ${shared.persona.appearance}` : "", shared.persona?.notes].filter(Boolean).join("\n");
    const persisted = snapshot.settings, remember = persisted?.rememberApiKey ?? shared.settings?.rememberApiKey ?? true, modelId = persisted?.modelId || shared.settings?.modelId || "gemini-3.5-flash";
    const responseLength = persisted?.responseLength ?? (shared.settings?.responseLength === "concise" ? "concise" : shared.settings?.responseLength === "long" || shared.settings?.responseLength === "very-long" ? "long" : "normal");
    const apiKey = remember ? localStorage.getItem(API_KEY_LOCAL) ?? "" : sessionStorage.getItem(API_KEY_SESSION) ?? ""; settings = { id: "world-settings", modelId, responseLength, rememberApiKey: remember, apiKey };
    const requested = new URL(location.href).searchParams.get("session") ?? ""; activeSessionId = sessions.some((s) => s.id === requested) ? requested : [...sessions].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? "";
  } catch (error) { showError(error instanceof Error ? error.message : "World IF 데이터를 불러오지 못했습니다."); }
  finally { app.hidden = false; render(); }
}

$("#world-new").addEventListener("click", renderSetup); $("#world-settings-open").addEventListener("click", openSettings); $("#world-settings-close").addEventListener("click", () => { settingsOverlay.hidden = true; }); settingsOverlay.addEventListener("mousedown", (e) => { if (e.target === settingsOverlay) settingsOverlay.hidden = true; }); $("#world-error-close").addEventListener("click", clearError);
sendButton.addEventListener("click", () => void send()); composer.addEventListener("input", () => { sendButton.disabled = generating || !composer.value.trim(); }); composer.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } });
window.addEventListener("world-if:reply-stream", (event) => { const detail = (event as CustomEvent<{ reply?: string }>).detail; if (!generating || typeof detail?.reply !== "string") return; streamedReply = detail.reply; const session = activeSession(); if (session) renderMessageList(session); });
void initialize();
