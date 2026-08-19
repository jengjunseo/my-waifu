# ADR — Separate World IF Engine

Date: 2026-08-19

## Decision
Implement World IF as a separate page/runtime (`world.html` + `src/world-if/*`) rather than extending the existing Han Doa character prompt. Use a separate IndexedDB `chara-world-if-db`; shared Chara persona/settings are read-only inputs.

## Why
Han Doa is user-approved and frozen. 1:1 roleplay and multi-NPC world simulation have different state, prompt, knowledge and UI contracts. Separate persistence avoids migration risk to Character Chat.

## Rejected
- A giant `if world ... else ...` inside the current `buildContext()` — couples prompt engines and enlarges regression surface.
- Treating Toaru as one synthetic Character card — affection/innerThought/one-character assumptions are structurally wrong.
- Committing the raw old transcript as runtime few-shot corpus — goal is generation dynamics, not wording/plot; raw corpus also needlessly expands public-repo exposure.

## Consequences
World IF sessions/settings persist independently. Character Chat backup does not include World IF v1 sessions. Later worlds can reuse this engine without changing Han Doa.
