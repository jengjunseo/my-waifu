type Preset = {
  label: string;
  model: string;
  length: "concise" | "normal" | "long" | "very-long";
  tone: "free";
};

const DEFAULT_FREE_MODEL = "google/gemma-4-26b-a4b-it:free";

const retiredPresetModels = new Set([
  "deepseek/deepseek-v4-flash:free",
  "z-ai/glm-4.7-flash",
  "minimax/minimax-m2-her",
  "z-ai/glm-4.5-air:free",
  "openrouter/free",
]);

const presets: Preset[] = [
  {
    label: "💚 1. Gemma 4 26B A4B · FREE RP",
    model: DEFAULT_FREE_MODEL,
    length: "normal",
    tone: "free",
  },
  {
    label: "⚡ 2. Ling 3.0 Flash · FREE FAST",
    model: "inclusionai/ling-3.0-flash:free",
    length: "normal",
    tone: "free",
  },
  {
    label: "🧪 3. GPT-OSS 20B · FREE ALT",
    model: "openai/gpt-oss-20b:free",
    length: "normal",
    tone: "free",
  },
];

function findSettingsFields() {
  const title = document.querySelector<HTMLElement>("#modal-title");
  const body = document.querySelector<HTMLElement>("#modal-body");
  if (!title || !body || title.textContent?.trim() !== "설정") return null;

  const fields = Array.from(body.querySelectorAll<HTMLElement>(".field"));
  const keyField = fields.find((field) => {
    const caption = field.querySelector("span")?.textContent?.trim() ?? "";
    return caption.includes("API Key");
  });
  const modelField = fields.find((field) => field.querySelector("span")?.textContent?.trim() === "Model ID");
  const lengthField = fields.find((field) => field.querySelector("span")?.textContent?.trim() === "응답 길이");
  const keyInput = keyField?.querySelector<HTMLInputElement>("input");
  const modelInput = modelField?.querySelector<HTMLInputElement>("input");
  const lengthSelect = lengthField?.querySelector<HTMLSelectElement>("select");
  if (!keyField || !keyInput || !modelField || !modelInput || !lengthSelect) return null;
  return { keyField, keyInput, modelField, modelInput, lengthSelect };
}

function installOpenRouterPresets() {
  const fields = findSettingsFields();
  if (!fields) return;

  const { keyField, keyInput, modelField, modelInput, lengthSelect } = fields;

  // Idempotency guard must run before touching observed DOM. Reassigning
  // textContent can trigger childList mutations and previously starved mobile
  // touch handling through a MutationObserver feedback loop.
  let wrap = document.querySelector<HTMLElement>(".latency-presets");
  if (wrap?.dataset.openrouterPresets === "free-v2") return;

  const caption = keyField.querySelector<HTMLElement>("span");
  const captionText = "API Key · OpenRouter / Gemini";
  if (caption && caption.textContent !== captionText) caption.textContent = captionText;
  keyInput.placeholder = "sk-or-v1-...  /  AIza...";

  const keyNote = keyField.querySelector<HTMLElement>("small");
  const keyNoteText = "OpenRouter 프리셋은 sk-or-v1-... 키를 사용합니다. 아래 세 프리셋은 모두 고정 :free 모델입니다. 기존 gemini-* Model ID는 Gemini 키로 계속 사용할 수 있습니다.";
  if (keyNote && keyNote.textContent !== keyNoteText) keyNote.textContent = keyNoteText;

  // Migrate stale preset selections in the settings UI. The provider adapter
  // also performs the same migration at request time so an old saved setting
  // cannot keep calling a retired/paid/random route.
  if (retiredPresetModels.has(modelInput.value.trim())) {
    modelInput.value = DEFAULT_FREE_MODEL;
    lengthSelect.value = "normal";
  }

  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "latency-presets";
    modelField.insertAdjacentElement("beforebegin", wrap);
  }
  wrap.dataset.openrouterPresets = "free-v2";
  wrap.replaceChildren();

  const heading = document.createElement("small");
  heading.className = "preset-heading";
  heading.textContent = "OpenRouter · 검증된 고정 FREE 모델";
  wrap.append(heading);

  for (const preset of presets) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = `model-preset model-preset-${preset.tone}`;
    control.textContent = preset.label;
    control.addEventListener("click", () => {
      modelInput.value = preset.model;
      lengthSelect.value = preset.length;
      modelInput.dispatchEvent(new Event("input", { bubbles: true }));
      lengthSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    wrap.append(control);
  }

  const warning = document.createElement("small");
  warning.className = "preset-warning";
  warning.textContent = "유료 모델과 OpenRouter Free Auto는 제거했습니다. 무료 모델은 OpenRouter 무료 한도와 제공자 혼잡도에 따라 일시적으로 제한될 수 있습니다.";
  wrap.append(warning);
}

const observer = new MutationObserver(installOpenRouterPresets);
observer.observe(document.body, { childList: true, subtree: true });
installOpenRouterPresets();
