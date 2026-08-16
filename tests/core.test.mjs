import test from "node:test";
import assert from "node:assert/strict";
import { demoCharacter } from "../dist/defaults.js";
import { createBackup } from "../dist/lib/backup.js";
import { selectCacheFriendlyHistory } from "../dist/lib/context.js";
import { parseNarration } from "../dist/lib/narration.js";
import { removeGeneratedMemories, restoreStateSnapshot } from "../dist/lib/regenerate.js";
import { advanceNarrativeTime, applyAffectionDelta, applyModelState, normalizeInnerThought } from "../dist/lib/state.js";

test("asterisk narration is parsed without exposing markers", () => {
  assert.deepEqual(parseNarration('\"안녕.\"\n\n*도아는 손을 흔들었다.*\n\n\"뭐 해?\"'), [
    { kind: "dialogue", text: '\"안녕.\"\n\n' },
    { kind: "narration", text: "도아는 손을 흔들었다." },
    { kind: "dialogue", text: '\n\n\"뭐 해?\"' },
  ]);
});

test("affection is deterministic and clamped", () => {
  assert.equal(applyAffectionDelta(40, 5), 45);
  assert.equal(applyAffectionDelta(98, 5), 100);
  assert.equal(applyAffectionDelta(2, -9), 0);
});

test("narrative time advances deterministically", () => {
  assert.equal(advanceNarrativeTime("2026-07-30T10:38:00.000Z", 20), "2026-07-30T10:58:00.000Z");
});

test("Han Doa thought strips whitespace character-specifically", () => {
  assert.equal(normalizeInnerThought(demoCharacter, "나 진짜 왜 이래\n너무 좋아"), "나진짜왜이래너무좋아");
  assert.equal(normalizeInnerThought({ ...demoCharacter, stripInnerThoughtWhitespace: false }, "나 진짜 왜 이래"), "나 진짜 왜 이래");
});

test("regenerate starts from stateBefore instead of stacking the previous delta", () => {
  const before = { turn: 12, dateTime: "2026-07-30T10:30:00.000Z", location: "거실", innerThought: "", affection: 30, mood: [] };
  const afterA = applyModelState(before, demoCharacter, { innerThought: "좋아", location: "거실", timeElapsedMinutes: 2, affectionDelta: 5, mood: ["happy"] });
  assert.equal(afterA.affection, 35);
  const restored = restoreStateSnapshot(before);
  const afterB = applyModelState(restored, demoCharacter, { innerThought: "조금좋아", location: "거실", timeElapsedMinutes: 1, affectionDelta: 2, mood: ["shy"] });
  assert.equal(afterB.affection, 32);
});

test("regenerate removes ghost memories produced by discarded response", () => {
  const base = { chatId: "c", type: "fact", importance: 0.8, createdAt: new Date().toISOString(), pinned: false };
  const list = [{ ...base, id: "keep", text: "keep" }, { ...base, id: "ghost-a", text: "a" }, { ...base, id: "ghost-b", text: "b" }];
  assert.deepEqual(removeGeneratedMemories(list, ["ghost-a", "ghost-b"]).map((m) => m.id), ["keep"]);
});

test("backup excludes runtime API key", () => {
  const backup = createBackup({ characters: [], personas: [], chats: [], messages: [], memories: [], settings: { modelId: "gemini-3.5-flash", responseLength: "normal", rememberApiKey: true } });
  assert.equal(JSON.stringify(backup).includes("apiKey"), false);
});

test("history truncation keeps the latest cache-friendly block", () => {
  const source = Array.from({ length: 30 }, (_, index) => ({
    id: `m-${index}`,
    chatId: "c",
    role: index % 2 ? "user" : "assistant",
    content: String(index),
    createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
    ...(index % 2 ? {} : { stateAfter: { turn: Math.floor(index / 2), dateTime: "2026-01-01T00:00:00.000Z", location: "거실", innerThought: "", affection: 0, mood: [] } }),
  }));
  const selected = selectCacheFriendlyHistory(source);
  assert.ok(selected.length >= 14 && selected.length <= 20);
  assert.equal(selected.at(-1)?.id, source.at(-1)?.id);
});
