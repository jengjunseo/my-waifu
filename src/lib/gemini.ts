import type { ModelTurnResult } from "../types.js";

const responseSchema = {
  type: "object",
  properties: {
    reply: { type: "string" },
    state: {
      type: "object",
      properties: {
        innerThought: { type: "string" },
        location: { type: "string" },
        timeElapsedMinutes: { type: "number", minimum: 0 },
        affectionDelta: { type: "number", minimum: -20, maximum: 20 },
        mood: { type: "array", items: { type: "string" }, maxItems: 5 },
      },
      required: ["innerThought", "location", "timeElapsedMinutes", "affectionDelta", "mood"],
    },
    memoryCandidates: {
      type: "array",
      maxItems: 5,
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

function validateResult(value: unknown): ModelTurnResult {
  if (!value || typeof value !== "object") throw new Error("모델 응답이 올바른 JSON 객체가 아닙니다.");
  const v = value as Partial<ModelTurnResult>;
  if (typeof v.reply !== "string" || !v.reply.trim()) throw new Error("캐릭터 응답이 비어 있습니다.");
  if (!v.state || typeof v.state !== "object") throw new Error("상태 정보가 없습니다.");
  const state = v.state as ModelTurnResult["state"];
  if (typeof state.innerThought !== "string" || typeof state.location !== "string") throw new Error("상태 문자열이 올바르지 않습니다.");
  if (!Number.isFinite(state.timeElapsedMinutes) || !Number.isFinite(state.affectionDelta)) throw new Error("상태 숫자가 올바르지 않습니다.");
  if (!Array.isArray(state.mood)) throw new Error("mood가 배열이 아닙니다.");
  const memoryCandidates = Array.isArray(v.memoryCandidates) ? v.memoryCandidates : [];
  return {
    reply: v.reply,
    state: {
      innerThought: state.innerThought,
      location: state.location,
      timeElapsedMinutes: Math.max(0, Number(state.timeElapsedMinutes)),
      affectionDelta: Math.max(-20, Math.min(20, Number(state.affectionDelta))),
      mood: state.mood.filter((x): x is string => typeof x === "string").slice(0, 5),
    },
    memoryCandidates: memoryCandidates
      .filter((m): m is ModelTurnResult["memoryCandidates"][number] => !!m && typeof m.text === "string" && typeof m.type === "string" && Number.isFinite(m.importance))
      .map((m) => ({ ...m, importance: Math.max(0, Math.min(1, Number(m.importance))) }))
      .slice(0, 5),
  };
}

function finishReasonMessage(finishReason: string, blockReason = ""): string | null {
  if (finishReason === "MAX_TOKENS") return "Gemini 응답이 출력 한도에서 잘렸습니다. 재시도해 주세요.";
  if (finishReason === "SAFETY" || blockReason === "SAFETY") return "Gemini 안전 필터로 응답이 중단되었습니다.";
  if (finishReason === "RECITATION") return "Gemini가 인용/반복 제한으로 응답을 중단했습니다.";
  if (finishReason === "LANGUAGE") return "Gemini가 언어 관련 제한으로 응답을 중단했습니다.";
  if (finishReason && finishReason !== "STOP") return `Gemini 응답이 비정상적으로 종료되었습니다. (${finishReason})`;
  if (blockReason) return `Gemini 요청이 차단되었습니다. (${blockReason})`;
  return null;
}

function dispatchReplyStream(reply: string, done = false) {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent("chara:reply-stream", { detail: { reply, done } }));
}

/** Structured-output streaming chunks are deltas. Never deduplicate them. */
export function appendStreamText(current: string, chunk: string): string {
  return current + chunk;
}

export function extractPartialReply(source: string): string {
  const match = /"reply"\s*:\s*"/.exec(source);
  if (!match) return "";
  let output = "";
  for (let index = match.index + match[0].length; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') return output;
    if (char !== "\\") {
      output += char;
      continue;
    }
    if (index + 1 >= source.length) return output;
    const escaped = source[++index];
    if (escaped === '"' || escaped === "\\" || escaped === "/") output += escaped;
    else if (escaped === "b") output += "\b";
    else if (escaped === "f") output += "\f";
    else if (escaped === "n") output += "\n";
    else if (escaped === "r") output += "\r";
    else if (escaped === "t") output += "\t";
    else if (escaped === "u") {
      const hex = source.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return output;
      output += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
    }
  }
  return output;
}

function parseModelResultText(text: string): ModelTurnResult {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  const attempts = [normalized];
  const unfenced = normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (unfenced !== normalized) attempts.push(unfenced);
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) attempts.push(normalized.slice(firstBrace, lastBrace + 1));

  for (const candidate of [...new Set(attempts)]) {
    try {
      return validateResult(JSON.parse(candidate));
    } catch {
      // Try the next conservative normalization. Never invent missing fields.
    }
  }
  throw new SyntaxError("최종 응답이 유효한 Chara JSON이 아닙니다.");
}

export type StreamPart = {
  text?: string;
  thought?: boolean;
};

export type StreamCandidate = {
  finishReason?: string;
  content?: { parts?: StreamPart[] };
};

export type StreamEnvelope = {
  candidates?: StreamCandidate[];
  promptFeedback?: { blockReason?: string };
};

export function parseSseEventBlock(block: string): StreamEnvelope | null {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    let value = line.slice(5);
    if (value.startsWith(" ")) value = value.slice(1);
    dataLines.push(value);
  }

  if (!dataLines.length) return null;
  const payload = dataLines.join("\n").trim();
  if (!payload || payload === "[DONE]") return null;

  try {
    return JSON.parse(payload) as StreamEnvelope;
  } catch {
    throw new Error("Gemini 스트리밍 이벤트 JSON을 해석하지 못했습니다. 연결이 손상되었거나 예상하지 못한 SSE 응답을 받았습니다.");
  }
}

export function collectCandidateText(candidate: StreamCandidate): string {
  return candidate.content?.parts
    ?.filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("") ?? "";
}

async function generateGeminiCharacterTurn(apiKey: string, modelId: string, prompt: string): Promise<ModelTurnResult> {
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
        responseJsonSchema: responseSchema,
        maxOutputTokens: 8192,
        thinkingConfig: {
          thinkingLevel: "MINIMAL",
        },
      },
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const json = await response.json();
      detail = typeof json?.error?.message === "string" ? ` ${json.error.message}` : "";
    } catch {
      // avoid leaking raw response bodies
    }
    throw new Error(`Gemini 요청에 실패했습니다. (${response.status})${detail}`);
  }
  if (!response.body) throw new Error("Gemini 스트리밍 응답을 읽을 수 없습니다.");

  let fullText = "";
  let lastPreview = "";
  let finishReason = "";
  let blockReason = "";
  let buffer = "";
  let eventCount = 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const consumeEvent = (block: string) => {
    const envelope = parseSseEventBlock(block);
    if (!envelope) return;
    eventCount += 1;

    const candidate = envelope.candidates?.[0];
    if (typeof candidate?.finishReason === "string") finishReason = candidate.finishReason;
    if (typeof envelope.promptFeedback?.blockReason === "string") blockReason = envelope.promptFeedback.blockReason;

    const chunk = candidate ? collectCandidateText(candidate) : "";
    fullText = appendStreamText(fullText, chunk);

    const preview = extractPartialReply(fullText);
    if (preview && preview !== lastPreview) {
      lastPreview = preview;
      dispatchReplyStream(preview);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consumeEvent(block);
    if (done) break;
  }
  if (buffer.trim()) consumeEvent(buffer);

  const finalPreview = extractPartialReply(fullText);
  if (finalPreview) dispatchReplyStream(finalPreview, true);

  if (!fullText) {
    const reason = finishReasonMessage(finishReason, blockReason);
    throw new Error(reason ?? "Gemini가 빈 응답을 반환했습니다.");
  }

  try {
    return parseModelResultText(fullText);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const reason = finishReasonMessage(finishReason, blockReason);
      const meta = `finishReason: ${finishReason || "없음"}, SSE events: ${eventCount}, chars: ${fullText.trim().length}`;
      throw new Error(reason ?? `Gemini 스트림의 최종 JSON을 해석하지 못했습니다. (${meta}) 재시도해 주세요.`);
    }
    throw error;
  }
}

type OpenRouterStreamEnvelope = {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  error?: { message?: string; code?: string | number };
};

function parseOpenRouterSseEventBlock(block: string): OpenRouterStreamEnvelope | null {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    let value = line.slice(5);
    if (value.startsWith(" ")) value = value.slice(1);
    dataLines.push(value);
  }
  if (!dataLines.length) return null;
  const payload = dataLines.join("\n").trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload) as OpenRouterStreamEnvelope;
  } catch {
    throw new Error("OpenRouter 스트리밍 이벤트를 해석하지 못했습니다. 연결이 손상되었거나 예상하지 못한 SSE 응답을 받았습니다.");
  }
}

function openRouterFinishReasonMessage(reason: string): string | null {
  if (reason === "length") return "OpenRouter 모델 응답이 출력 한도에서 잘렸습니다. 재시도해 주세요.";
  if (reason === "content_filter") return "OpenRouter 모델의 콘텐츠 필터로 응답이 중단되었습니다.";
  if (reason && reason !== "stop") return `OpenRouter 모델 응답이 비정상적으로 종료되었습니다. (${reason})`;
  return null;
}

function openRouterSupportsStrictSchema(modelId: string): boolean {
  return modelId !== "minimax/minimax-m2-her";
}

function openRouterReasoningOff(modelId: string): boolean {
  return modelId.startsWith("deepseek/deepseek-v4-flash")
    || modelId.startsWith("z-ai/glm-4.7-flash")
    || modelId.startsWith("z-ai/glm-4.5-air");
}

const OPENROUTER_JSON_REMINDER = `\n\n# OPENROUTER JSON REMINDER\n반드시 설명, 코드펜스, 접두사 없이 JSON 객체 하나만 출력한다. 최상위 키는 reply, state, memoryCandidates 세 개다. state에는 innerThought, location, timeElapsedMinutes, affectionDelta, mood를 모두 포함한다.`;

function buildOpenRouterBody(modelId: string, prompt: string, structured: boolean) {
  const body: Record<string, unknown> = {
    model: modelId,
    messages: [{ role: "user", content: prompt + OPENROUTER_JSON_REMINDER }],
    stream: true,
    max_tokens: 8192,
  };

  if (structured) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "chara_turn",
        strict: true,
        schema: responseSchema,
      },
    };
  }

  if (openRouterReasoningOff(modelId)) {
    body.reasoning = { effort: "none" };
  }

  return body;
}

async function openRouterFetch(apiKey: string, modelId: string, prompt: string): Promise<Response> {
  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey.trim()}`,
  };
  const wantsStructured = openRouterSupportsStrictSchema(modelId);
  let response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(buildOpenRouterBody(modelId, prompt, wantsStructured)),
  });

  // Some providers behind a model may not expose JSON-schema enforcement even
  // when the model itself can still follow the prompt contract. Fall back once
  // on parameter-validation errors instead of making the chat unusable.
  if (!response.ok && wantsStructured && (response.status === 400 || response.status === 422)) {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(buildOpenRouterBody(modelId, prompt, false)),
    });
  }
  return response;
}

async function generateOpenRouterCharacterTurn(apiKey: string, modelId: string, prompt: string): Promise<ModelTurnResult> {
  if (!apiKey.trim()) throw new Error("OpenRouter API Key를 먼저 설정해 주세요. (sk-or-v1-...) ");
  const response = await openRouterFetch(apiKey, modelId, prompt);
  if (!response.ok) {
    let detail = "";
    try {
      const json = await response.json();
      detail = typeof json?.error?.message === "string" ? ` ${json.error.message}` : "";
    } catch {
      // avoid leaking raw response bodies
    }
    throw new Error(`OpenRouter 요청에 실패했습니다. (${response.status})${detail}`);
  }
  if (!response.body) throw new Error("OpenRouter 스트리밍 응답을 읽을 수 없습니다.");

  let fullText = "";
  let lastPreview = "";
  let finishReason = "";
  let buffer = "";
  let eventCount = 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const consumeEvent = (block: string) => {
    const envelope = parseOpenRouterSseEventBlock(block);
    if (!envelope) return;
    eventCount += 1;
    if (envelope.error) throw new Error(`OpenRouter upstream 오류: ${envelope.error.message || envelope.error.code || "알 수 없는 오류"}`);

    const choice = envelope.choices?.[0];
    if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
    const chunk = typeof choice?.delta?.content === "string" ? choice.delta.content : "";
    fullText = appendStreamText(fullText, chunk);

    const preview = extractPartialReply(fullText);
    if (preview && preview !== lastPreview) {
      lastPreview = preview;
      dispatchReplyStream(preview);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consumeEvent(block);
    if (done) break;
  }
  if (buffer.trim()) consumeEvent(buffer);

  const finalPreview = extractPartialReply(fullText);
  if (finalPreview) dispatchReplyStream(finalPreview, true);

  if (!fullText.trim()) {
    const reason = openRouterFinishReasonMessage(finishReason);
    throw new Error(reason ?? "OpenRouter 모델이 빈 응답을 반환했습니다.");
  }

  try {
    return parseModelResultText(fullText);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const reason = openRouterFinishReasonMessage(finishReason);
      const meta = `model: ${modelId}, finishReason: ${finishReason || "없음"}, SSE events: ${eventCount}, chars: ${fullText.trim().length}`;
      throw new Error(reason ?? `OpenRouter 스트림의 최종 JSON을 해석하지 못했습니다. (${meta}) 재시도해 주세요.`);
    }
    throw error;
  }
}

function isDirectGeminiModel(modelId: string): boolean {
  return modelId.trim().startsWith("gemini-");
}

export async function generateCharacterTurn(apiKey: string, modelId: string, prompt: string): Promise<ModelTurnResult> {
  if (isDirectGeminiModel(modelId)) return generateGeminiCharacterTurn(apiKey, modelId, prompt);
  return generateOpenRouterCharacterTurn(apiKey, modelId, prompt);
}
