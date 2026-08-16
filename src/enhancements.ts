import type { Chat, Message } from "./types.js";
import { getAll } from "./lib/db.js";

function mustQuery<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing Chara enhancement target: ${selector}`);
  return node;
}

const messagesRoot = mustQuery<HTMLElement>("#messages");
const composerInput = mustQuery<HTMLTextAreaElement>("#composer-input");
const sendButton = mustQuery<HTMLButtonElement>("#send-button");

const style = document.createElement("style");
style.textContent = `
.turn-hud {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,.06);
  color: #717783;
  font-size: 11.5px;
  line-height: 1.62;
  letter-spacing: -.01em;
}
.turn-hud-line { white-space: pre-wrap; overflow-wrap: anywhere; }
.turn-hud-thought { color: #838996; }
.turn-hud-affection { color: #b78696; }
@media (max-width: 600px) {
  .turn-hud { font-size: 11px; margin-top: 14px; padding-top: 10px; }
}
`;
document.head.append(style);

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
    ["turn-hud-line", `⏳ [${state.turn}]`],
    ["turn-hud-line", `📆 날짜/시간: [${formatNarrativeDate(state.dateTime)}]`],
    ["turn-hud-line", `📍 위치: [${state.location || "-"}]`],
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
  queueHudRefresh();
});
observer.observe(messagesRoot, { childList: true, subtree: true });

queueHudRefresh();
