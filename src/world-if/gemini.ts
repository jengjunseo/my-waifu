import { appendStreamText, collectCandidateText, extractPartialReply, normalizeReplyText, parseSseEventBlock } from "../lib/gemini.js";
import type { WorldTurnResult } from "./types.js";

const worldResponseSchema = {
  type: "object",
  properties: {
    reply: { type: "string" },
    state: {
      type: "object",
      properties: {
        location: { type: "string" },
        timeElapsedMinutes: { type: "number", minimum: 0 },
        currentCast: { type: "array", items: { type: "string" }, maxItems: 10 },
        sceneTone: { type: "string" },
        relationshipChanges: { type: "array", items: { type: "string" }, maxItems: 6 },
        revealedFacts: { type: "array", items: { type: "string" }, maxItems: 8 },
        threadChanges: { type: "array", items: { type: "string" }, maxItems: 6 },
        canonDivergences: { type: "array", items: { type: "string" }, maxItems: 6 },
      },
      required: [
        "location",
        "timeElapsedMinutes",
        "currentCast",
        "sceneTone",
        "relationshipChanges",
        "revealedFacts",
        "threadChanges",
        "canonDivergences",
      ],
    },
    memoryCandidates: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          type: { type: "string" },
          importance: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["text", "type", "importance"],
      },
    },
  },
  required: ["reply", "state", "memoryCandidates"],
};

function cleanStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, max);
}

export function validateWorldTurn(value: unknown): WorldTurnResult {
  if (!value || typeof value !== "object") throw new Error("World IF 응답이 JSON 객체가 아닙니다.");
  const input = value as Partial<WorldTurnResult>;
  const reply = typeof input.reply === "string" ? normalizeReplyText(input.reply) : "";
  if (!reply) throw new Error("World IF 본문이 비어 있습니다.");
  if (!input.state || typeof input.state !== "object") throw new Error("World IF 상태 정보가 없습니다.");
  const state = input.state as WorldTurnResult["state"];
  if (typeof state.location !== "string" || typeof state.sceneTone !== "string" || !Number.isFinite(state.timeElapsedMinutes)) {
    throw new Error("World IF 상태 형식이 올바르지 않습니다.");
  }

  const memories = Array.isArray(input.memoryCandidates) ? input.memoryCandidates : [];
  return {
    reply,
    state: {
      location: state.location,
      timeElapsedMinutes: Math.max(0, Number(state.timeElapsedMinutes)),
      currentCast: cleanStrings(state.currentCast, 10),
      sceneTone: state.sceneTone,
      relationshipChanges: cleanStrings(state.relationshipChanges, 6),
      revealedFacts: cleanStrings(state.revealedFacts, 8),
      threadChanges: cleanStrings(state.threadChanges, 6),
      canonDivergences: cleanStrings(state.canonDivergences, 6),
    },
    memoryCandidates: memories
      .filter((item): item is WorldTurnResult["memoryCandidates"][number] =>
        Boolean(item) &&
        typeof item.text === "string" &&
        typeof item.type === "string" &&
        Number.isFinite(item.importance))
      .map((item) => ({
        text: item.text.trim(),
        type: item.type.trim() || "fact",
        importance: Math.max(0, Math.min(1, Number(item.importance))),
      }))
      .filter((item) => item.text.length >= 4)
      .slice(0, 6),
  };
}

function dispatchPreview(reply: string, done = false) {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent("world-if:reply-stream", { detail: { reply, done } }));
}

export async function generateWorldTurn(apiKey: string, modelId: string, prompt: string): Promise<WorldTurnResult> {
  if (!apiKey.trim()) throw new Error("Gemini API Key를 먼저 설정해 주세요.");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey.trim(),
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: worldResponseSchema,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: "MINIMAL" },
      },
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const json = await response.json();
      detail = typeof json?.error?.message === "string" ? ` ${json.error.message}` : "";
    } catch {
      // Do not expose raw provider bodies.
    }
    throw new Error(`Gemini 요청에 실패했습니다. (${response.status})${detail}`);
  }
  if (!response.body) throw new Error("Gemini 스트리밍 응답을 읽을 수 없습니다.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let lastPreview = "";

  const consume = (block: string) => {
    const envelope = parseSseEventBlock(block);
    const candidate = envelope?.candidates?.[0];
    if (!candidate) return;
    fullText = appendStreamText(fullText, collectCandidateText(candidate));
    const preview = normalizeReplyText(extractPartialReply(fullText));
    if (preview && preview !== lastPreview) {
      lastPreview = preview;
      dispatchPreview(preview);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consume(block);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);

  const finalPreview = normalizeReplyText(extractPartialReply(fullText));
  if (finalPreview) dispatchPreview(finalPreview, true);
  if (!fullText.trim()) throw new Error("Gemini가 빈 World IF 응답을 반환했습니다.");

  try {
    return validateWorldTurn(JSON.parse(fullText.replace(/^\uFEFF/, "").trim()));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Gemini World IF 최종 JSON을 해석하지 못했습니다. 재시도해 주세요.");
    throw error;
  }
}
