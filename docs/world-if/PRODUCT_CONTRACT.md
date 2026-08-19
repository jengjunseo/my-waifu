# World IF v1 Product Contract

## Goal
Put a USER/OC into a known fictional world and let the world, narrator, and multiple NPCs react autonomously over a long-running IF session.

First world: 《어떤 마술의 금서목록》, Daihaseisai day one.

## Invariants
- Han Doa Character Chat is frozen at baseline `ffded265d2365e3ecf3762ceddbab0dbc6446b66`.
- Character Chat and World IF are separate engines.
- USER controls USER dialogue/choices/thoughts/intentions. The engine controls consequences and NPC/world reactions.
- Canon defines initial world rules, not a railroad. Recorded divergences override downstream canon.
- NPC knowledge must have a causal path; true lore is not automatically dialogue knowledge.
- The old enjoyable transcript is analysis material for dynamics only, never a canon source or runtime corpus.
- One user turn = one Gemini generation.
- Existing Character Chat data is not migrated or destructively rewritten.

## v1 state
World sessions track date/time offset, location, current cast, scene tone, relationships, active threads, revealed facts, and canon divergences. Avoid HP/XP/quest RPG systems until a demonstrated need exists.
