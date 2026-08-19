import test from "node:test";
import assert from "node:assert/strict";
import { applyWorldTurn, createWorldSession, formatWorldClock } from "../dist/world-if/state.js";
import { buildWorldContext } from "../dist/world-if/context.js";
import { selectRelevantCharacters } from "../dist/world-if/toaru-knowledge.js";

const config = { worldId:"toaru", title:"test", timelineAnchor:"daihaseisai-day1", userName:"원대", userDescription:"테스트 OC", ifCondition:"학원도시에 정체불명의 새 학생이 전입했다.", startLocation:"제7학구" };

test("World IF preserves initial divergence and accumulates deltas", () => {
  const session = createWorldSession(config, "2026-08-19T00:00:00.000Z");
  const next = applyWorldTurn(session.state, { location:"카미조의 기숙사 앞", timeElapsedMinutes:12, currentCast:["카미조 토우마","인덱스"], sceneTone:"생활 코미디", relationshipChanges:[], revealedFacts:[], threadChanges:["전입 이유가 아직 설명되지 않았다."], canonDivergences:["원대가 카미조 기숙사 앞에 나타났다."] });
  assert.equal(next.turn,1); assert.equal(formatWorldClock(next),"9월 19일 08:12");
  assert.ok(next.canonDivergences.includes(config.ifCondition)); assert.ok(next.canonDivergences.includes("원대가 카미조 기숙사 앞에 나타났다."));
});

test("context protects USER agency and divergence priority", () => {
  const session=createWorldSession(config);
  const prompt=buildWorldContext({session,recentMessages:[],memories:[],userMessage:"미사카를 발견하고 손을 흔든다.",settings:{id:"world-settings",modelId:"gemini-3.5-flash",responseLength:"normal",rememberApiKey:true,apiKey:"x"}});
  assert.match(prompt,/USER가 직접 쓰지 않은 USER의 대사/); assert.match(prompt,/divergence는 원작보다 우선/); assert.match(prompt,/미사카 미코토/); assert.match(prompt,/마술 사이드의 체계/);
});

test("character selection loads a bounded relevant cast", () => { const selected=selectRelevantCharacters("쇼쿠호 미사키에게 말을 건다.",[]); assert.ok(selected.some((x)=>x.id==="shokuhou")); assert.ok(selected.length<=7); });
