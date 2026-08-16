# Chara v0.1

로컬 우선 BYOK 캐릭터챗 베이스라인입니다. 캐릭터/Persona/대화/기억은 브라우저 IndexedDB에 저장되고, Gemini API Key는 사용자가 런타임에 직접 입력합니다.

## 실행

```bash
npm install
npm run dev
```

검증:

```bash
npm test
npm run build
```

## 제품 계약

- 기본 모델 ID: `gemini-3.5-flash` (설정에서 변경 가능)
- 정상 사용자 턴당 Gemini generation 1회
- `*상황 묘사*`는 회색 italic으로 렌더링
- 상태: turn / dateTime / location / innerThought / affection / mood
- 호감도/시간 계산은 앱 코드가 deterministic하게 적용
- 한도아 demo의 innerThought는 캐릭터별 옵션으로 공백 제거
- IndexedDB local persistence, 로그인/서버 DB/Supabase 없음
- API Key는 소스 및 JSON backup에 포함하지 않음
- Regenerate는 직전 state snapshot으로 롤백한 뒤 새 결과만 적용

## Gemini API

Google Gemini REST `generateContent`를 사용하며 structured JSON response를 요청합니다. 키는 설정 화면에서 입력합니다. 테스트/빌드에는 실제 Gemini credential이 필요하지 않습니다.

## v0.1에서 의도적으로 제외

클라우드 동기화, 로그인, 결제, 음성, 이미지 생성, 그룹챗, vector DB/embedding retrieval, 소셜 기능.
