type Preset = {
  label: string;
  model: string;
  length: "concise" | "normal" | "long" | "very-long";
  tone: "free" | "paid" | "fallback";
};

const presets: Preset[] = [
  {
    label: "🆓 1. DeepSeek V4 Flash · FREE",
    model: "deepseek/deepseek-v4-flash:free",
    length: "normal",
    tone: "free",
  },
  {
    label: "🧠 2. GLM 4.7 Flash · $0.06 / $0.40",
    model: "z-ai/glm-4.7-flash",
    length: "normal",
    tone: "paid",
  },
  {
    label: "💜 3. MiniMax M2-her · $0.30 / $1.20",
    model: "minimax/minimax-m2-her",
    length: "normal",
    tone: "paid",
  },
  {
    label: "🆓 GLM 4.5 Air · FREE",
    model: "z-ai/glm-4.5-air:free",
    length: "normal",
    tone: "free",
  },
  {
    label: "🎲 OpenRouter Free Auto · FREE",
    model: "openrouter/free",
    length: "concise",
    tone: "fallback",
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
  return { body, keyField, keyInput, modelField, modelInput, lengthSelect };
}

function installOpenRouterPresets() {
  const fields = findSettingsFields();
  if (!fields) return;

  const { keyField, keyInput, modelField, modelInput, lengthSelect } = fields;

  // IMPORTANT: check the idempotency guard before touching any observed DOM.
  // Reassigning textContent fires childList mutations even when the visible text
  // is unchanged; doing that before this guard caused a MutationObserver feedback
  // loop that could starve mobile touch/scroll handling.
  let wrap = document.querySelector<HTMLElement>(".latency-presets");
  if (wrap?.dataset.openrouterPresets === "1") return;

  const caption = keyField.querySelector<HTMLElement>("span");
  const captionText = "API Key · OpenRouter / Gemini";
  if (caption && caption.textContent !== captionText) caption.textContent = captionText;
  keyInput.placeholder = "sk-or-v1-...  /  AIza...";

  const keyNote = keyField.querySelector<HTMLElement>("small");
  const keyNoteText = "OpenRouter 프리셋은 sk-or-v1-... 키를 사용합니다. 기존 gemini-* Model ID는 Gemini 키로 계속 사용할 수 있습니다. 키는 JSON 백업에 포함되지 않습니다.";
  if (keyNote && keyNote.textContent !== keyNoteText) keyNote.textContent = keyNoteText;

  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "latency-presets";
    modelField.insertAdjacentElement("beforebegin", wrap);
  }
  wrap.dataset.openrouterPresets = "1";
  wrap.replaceChildren();

  const heading = document.createElement("small");
  heading.className = "preset-heading";
  heading.textContent = "OpenRouter 모델 프리셋";
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
  warning.textContent = "DeepSeek V4 Flash :free, GLM 4.5 Air :free, Free Auto는 무료 라우트입니다. GLM 4.7 Flash와 MiniMax M2-her는 OpenRouter 유료 모델입니다.";
  wrap.append(warning);
}

const observer = new MutationObserver(installOpenRouterPresets);
observer.observe(document.body, { childList: true, subtree: true });
installOpenRouterPresets();
