# claude-council

여러 사람이 하나의 Claude Code 세션을 공유할 때, Claude가 던지는 질문(`AskUserQuestion`)을 Discord 채널로 전달하고, 참여자들이 버튼 투표로 합의한 답을 다시 Claude에 주입하는 협업 도구.

## 목표 (MVP)

Discord에서 4-10명 팀이, 호스트의 Claude Code(TypeScript Agent SDK) 세션이 던지는 객관식 질문을 `canUseTool`로 가로채 3분/과반 규칙(미달-동점 시 호스트 결정)으로 버튼 투표해 합의한 답을 Claude에 주입하는 협업 도구의 MVP를, 집계-타임아웃-호스트 폴백을 모킹 자동화 테스트로 검증해 만든다.

## 핵심 메커니즘

Claude Code의 질문은 내장 `AskUserQuestion` 도구로 나온다. Agent SDK의 `canUseTool` 콜백이 이 도구 호출을 가로채:

1. Claude가 만든 `questions` 배열을 꺼낸다.
2. Discord 채널에 질문과 선택지를 버튼 메시지로 포워딩한다.
3. 참여자 투표를 수집/집계한다.
4. 합의된 답으로 `answers`를 구성해 `{ behavior: "allow", updatedInput: { questions, answers } }`로 반환 -> Claude가 그 답을 받은 것처럼 작업을 이어간다.

```
[호스트] --Agent SDK--> [Claude Code 세션]
   Claude가 AskUserQuestion 호출
    -> canUseTool 가로채기
    -> Discord 채널로 질문 포워딩 (버튼)
    -> 참여자 투표 집계
    -> 합의된 answers 주입
```

> 참고: Hooks(PreToolUse)는 allow/deny만 가능해 답 주입 불가, 커스텀 MCP 도구는 내장 질문 UI 대체 불가, headless `-p` 단독은 답 주입 경로 없음. 따라서 Agent SDK `canUseTool`이 유일한 경로다. (공식 가이드 "Handle clarifying questions")

## 확정된 설계

| 항목 | 결정 |
|---|---|
| 기반 | TypeScript Agent SDK (`@anthropic-ai/claude-agent-sdk`) |
| 채널 | Discord 봇 (discord.js, 버튼 투표) |
| 투표 타임아웃 | 기본 3분, 설정 가능 |
| 정족수 | 기본 과반, 설정 가능 |
| 폴백 | 정족수 미달-동점 시 호스트(세션 시작자) 최종 결정 |
| 인증 | Discord 채널 멤버십 기반 경량 |
| 질문 유형 | MVP는 객관식만. 자유텍스트 2단계(제출->재투표)는 향후 |
| 검증 | Discord API 모킹 단위/통합 테스트 (집계/타임아웃/폴백). e2e는 수동 시연. `npm test` green = MVP 완성 |

## MVP 범위

- IN: 객관식 투표 end-to-end, 호스트 폴백, 타임아웃 만료
- OUT(향후): 자유텍스트 2단계, 에러 복원(봇 다운/세션 끊김), Slack 지원

## 디렉토리 구조

```
src/
  index.ts              # 진입점: 호스트가 세션 시작, 봇 연결
  config.ts             # 투표 규칙 설정 로드 (타임아웃/정족수/호스트)
  council/
    types.ts            # 도메인 타입 (질문/투표/결과)
    canUseTool.ts       # AskUserQuestion 가로채기 핸들러
    tally.ts            # 투표 집계 로직 (과반/정족수/동점/호스트 폴백)
  discord/
    adapter.ts          # 질문 포워딩 + 버튼 투표 수집 (MessagingAdapter 인터페이스)
test/
  tally.test.ts         # 집계/타임아웃/폴백 단위 테스트
```

## 개발

```bash
npm install
cp .env.example .env   # 토큰/키 채우기
npm run dev            # 개발 실행
npm test               # 테스트
```

> 기존 `stt-verify-agent`(Kotlin/Koog/Gemini)는 UX/구조 참고용이며 이 프로젝트와 코드 공유는 없다.
