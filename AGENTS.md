# Chara product constitution

- Chara is a local-first BYOK character-chat product. API keys must never enter JSON backups or source control.
- The Han Doa experience at `main@ffded265d2365e3ecf3762ceddbab0dbc6446b66` is a frozen baseline. Do not change its prompt, style corpus, opening scene, state semantics, or persistence unless a feature explicitly targets a demonstrated Han Doa regression.
- `Character Chat` and `World IF` are separate narrative engines. Share stable low-level primitives only when their product contracts stay unchanged.
- World IF treats canon as the initial world model, never as a railroad. Recorded session divergences become current truth.
- Never invent the USER's unprovided dialogue, decisions, emotions, thoughts, intentions, or additional actions.
- Keep lore provenance in `docs/world-if/worlds/`; keep engine decisions in `docs/adr/`.
- Existing Character Chat IndexedDB data is compatibility-sensitive. World IF v1 uses a separate database and reads shared persona/settings read-only.
- Gemini direct browser transport is stable infrastructure. Explore cheaply; certify the selected candidate in the real product path.
