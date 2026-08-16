import type { Chat, Message } from "./types.js";
import { getAll } from "./lib/db.js";

function mustQuery<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing Chara enhancement target: ${selector}`);
  return node;
}

const messagesRoot = mustQuery<HTMLElement>("#messages");
const messageScroll = mustQuery<HTMLElement>("#message-scroll");
const chatStage = mustQuery<HTMLElement>(".chat-stage");
const composer = mustQuery<HTMLElement>(".composer");
const composerInput = mustQuery<HTMLTextAreaElement>("#composer-input");
const sendButton = mustQuery<HTMLButtonElement>("#send-button");
const characterButton = mustQuery<HTMLButtonElement>("#composer-character");

function keepCrackComposerLabel() {
  composerInput.placeholder = "메시지 보내기";
}

function installComposerTools() {
  if (composer.querySelector(".composer-tools")) return;
  const tools = document.createElement("div");
  tools.className = "composer-tools";

  characterButton.textContent = "✦";
  characterButton.title = "캐릭터 편집";
  tools.append(characterButton);

  const persona = document.createElement("button");
  persona.type = "button";
  persona.className = "composer-tool";
  persona.textContent = "/";
  persona.title = "Persona";
  persona.setAttribute("aria-label", "Persona 열기");
  persona.addEventListener("click", () => (document.querySelector<HTMLButtonElement>("#persona-open"))?.click());

  const settings = document.createElement("button");
  settings.type = "button";
  settings.className = "composer-tool";
  settings.textContent = "☷";
  settings.title = "설정";
  settings.setAttribute("aria-label", "설정 열기");
  settings.addEventListener("click", () => (document.querySelector<HTMLButtonElement>("#settings-open"))?.click());

  tools.append(persona, settings);
  composer.insertBefore(tools, sendButton);
}

function installScrollToBottom() {
  if (chatStage.querySelector(".scroll-to-bottom")) return;
  const control = document.createElement("button");
  control.type = "button";
  control.className = "scroll-to-bottom";
  control.textContent = "⌃";
  control.title = "최신 메시지로";
  control.setAttribute("aria-label", "최신 메시지로 이동");
  control.hidden = true;
  control.addEventListener("click", () => messageScroll.scrollTo({ top: messageScroll.scrollHeight, behavior: "smooth" }));
  chatStage.append(control);

  const sync = () => {
    const distance = messageScroll.scrollHeight - messageScroll.scrollTop - messageScroll.clientHeight;
    control.hidden = distance < 220;
  };
  messageScroll.addEventListener("scroll", sync, { passive: true });
  new ResizeObserver(sync).observe(messageScroll);
  sync();
}

function normalizeText(value: string): string {
  return value.replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

function formatNarrativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  const weekdays = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}|${pad(date.getHours())}:${pad(date.getMinutes())}|${weekdays[date.getDay()]}`;
}

function affectionDelta(message: Message): string {
  if (!message.stateBefore || !message.stateAfter) return "-";
  const delta = message.stateAfter.affection - message.stateBefore.affection;
  return delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : "-";
}

function createHud(message: Message): HTMLElement | null {
  const state = message.stateAfter;
  if (!state) return null;
  const hud = document.createElement("div");
  hud.className = "turn-hud";
  const lines: Array<[string, string]> = [
    ["turn-hud-line turn-hud-turn", `⏳ [${state.turn}]`],
    ["turn-hud-line turn-hud-date", `📆 날짜/시간: [${formatNarrativeDate(state.dateTime)}]`],
    ["turn-hud-line turn-hud-location", `📍 위치: [${state.location || "-"}]`],
    ["turn-hud-line turn-hud-thought", `💭 생각: [${state.innerThought || "-"}]`],
    ["turn-hud-line turn-hud-affection", `💗[${state.affection}]: ${affectionDelta(message)}`],
  ];
  for (const [className, text] of lines) {
    const line = document.createElement("div");
    line.className = className;
    line.textContent = text;
    hud.append(line);
  }
  return hud;
}

function visibleTimeline() {
  return Array.from(messagesRoot.querySelectorAll<HTMLElement>(":scope > .message-row:not(.typing-row)"))
    .map((row) => ({
      role: row.classList.contains("user-row") ? "user" as const : "assistant" as const,
      text: normalizeText(row.querySelector<HTMLElement>(".rich-text")?.textContent ?? ""),
      row,
    }))
    .filter((item) => item.text.length > 0);
}

async function resolveActiveMessages(): Promise<Message[]> {
  const [chats, allMessages] = await Promise.all([getAll<Chat>("chats"), getAll<Message>("messages")]);
  const visible = visibleTimeline();
  if (!visible.length) return [];

  let best: { score: number; messages: Message[] } | null = null;
  for (const chat of chats) {
    const chatMessages = allMessages
      .filter((message) => message.chatId === chat.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const candidate = chatMessages.slice(-visible.length);
    if (candidate.length !== visible.length) continue;
    let score = 0;
    for (let i = 0; i < visible.length; i += 1) {
      if (candidate[i].role === visible[i].role) score += 2;
      if (normalizeText(candidate[i].content) === visible[i].text) score += 5;
    }
    const headerAffection = Number(document.querySelector("#header-affection")?.textContent ?? NaN);
    const headerLocation = document.querySelector("#header-location")?.textContent?.trim() ?? "";
    if (chat.state.affection === headerAffection) score += 3;
    if (chat.state.location === headerLocation) score += 3;
    if (!best || score > best.score) best = { score, messages: candidate };
  }
  return best?.messages ?? [];
}

function polishMessageActions() {
  for (const action of messagesRoot.querySelectorAll<HTMLButtonElement>(".message-actions button")) {
    const raw = action.textContent?.trim() ?? "";
    if (raw === "복사") {
      action.textContent = "⧉";
      action.title = "복사";
      action.setAttribute("aria-label", "메시지 복사");
    } else if (raw.includes("재생성")) {
      action.textContent = "↻";
      action.title = "재생성";
      action.setAttribute("aria-label", "답변 재생성");
    }
  }
}

let refreshQueued = false;
function queueHudRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    void refreshHud();
  });
}

async function refreshHud() {
  keepCrackComposerLabel();
  polishMessageActions();
  const timeline = visibleTimeline();
  const matchedMessages = await resolveActiveMessages();
  if (timeline.length !== matchedMessages.length) return;
  for (let i = 0; i < timeline.length; i += 1) {
    if (timeline[i].role !== "assistant") continue;
    const message = matchedMessages[i];
    if (!message?.stateAfter) continue;
    const row = timeline[i].row;
    if (row.dataset.hudMessageId === message.id && row.querySelector(".turn-hud")) continue;
    row.querySelector(".turn-hud")?.remove();
    const hud = createHud(message);
    if (!hud) continue;
    row.querySelector<HTMLElement>(".assistant-content")?.append(hud);
    row.dataset.hudMessageId = message.id;
  }
}

let sendLocked = false;
let sawTyping = false;
let unlockTimer = 0;

function unlockSendGuard() {
  sendLocked = false;
  sawTyping = false;
  window.clearTimeout(unlockTimer);
  sendButton.disabled = !composerInput.value.trim();
}

function claimSend(event: Event) {
  if (!composerInput.value.trim()) return;
  if (sendLocked) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  sendLocked = true;
  sendButton.disabled = true;
  unlockTimer = window.setTimeout(() => {
    if (!sawTyping) unlockSendGuard();
  }, 2000);
}

document.addEventListener("click", (event) => {
  const target = event.target as Node | null;
  if (target && (target === sendButton || sendButton.contains(target))) claimSend(event);
}, true);

document.addEventListener("keydown", (event) => {
  if (event.target === composerInput && event.key === "Enter" && !event.shiftKey) claimSend(event);
}, true);

const observer = new MutationObserver(() => {
  const typing = Boolean(messagesRoot.querySelector(".typing-row"));
  if (typing) sawTyping = true;
  if (sendLocked && sawTyping && !typing) unlockSendGuard();
  keepCrackComposerLabel();
  polishMessageActions();
  queueHudRefresh();
});
observer.observe(messagesRoot, { childList: true, subtree: true });

installComposerTools();
installScrollToBottom();
keepCrackComposerLabel();
queueHudRefresh();
