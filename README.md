# claude-council

여러 사람이 하나의 Claude Code 세션을 공유할 때, Claude의 객관식 질문을 Discord 버튼 투표로 보내 팀이 합의한 답을 Claude가 받게 하는 협업 도구.

메인 경로는 Claude가 명시적으로 호출하는 `council_vote` MCP stdio 도구다. 표준 `claude` CLI/IDE 에서 SDK 래퍼 없이 그대로 동작한다.

## 동작 흐름

```
[Claude Code 세션] --council_vote 호출--> [MCP stdio 서버]
   -> Discord 채널에 질문을 버튼 메시지로 게시
   -> 참여자 버튼 투표 수집 (라이브 카운트)
   -> 집계: 최다득표(plurality) / 정족수 / 동점 / 타임아웃 분류
   -> 폴백: 정족수 미달 - 동점 - 타임아웃 시 호스트가 최종 결정
   -> 합의 결과를 텍스트로 Claude 에 반환
```

## 투표 규칙

| 항목 | 기본값 | 설정 |
|---|---|---|
| 타임아웃 | 3분 (180초) | `VOTE_TIMEOUT_SECONDS` |
| 정족수 | 과반 (0.5) | `VOTE_QUORUM_RATIO` |
| 승자 | 최다득표(plurality) | - |
| 폴백 | 정족수 미달 - 동점 - 타임아웃 시 호스트 결정 | `HOST_USER_ID` |
| 인증 | Discord 채널 멤버십(봇 제외) | - |

---

# 설치

각 팀이 자기 Discord 봇을 한 번 만들어 쓰는 방식이다. 봇 토큰은 자동으로 얻을 수 없어 누군가 한 번은 아래 A 단계를 거쳐야 한다(약 3분). 채널 ID / 사용자 ID 는 Discord 개발자 모드 토글만 켜면 바로 복사할 수 있다.

준비물: Node.js >= 20, `claude` CLI, Discord 서버(길드) 관리 권한.

## A. Discord 봇 생성 (한 번만)

1. https://discord.com/developers/applications 접속 -> **New Application** -> 이름 입력.
2. 왼쪽 **Bot** 탭 -> **Add Bot**.
3. **Reset Token** -> 토큰 복사. 이 값이 `DISCORD_TOKEN`. (한 번만 보이므로 안전한 곳에 보관)
4. 같은 Bot 탭에서 **Privileged Gateway Intents** -> **SERVER MEMBERS INTENT** 를 켠다.
   - 버튼 투표 자체(interaction)는 특권 인텐트가 없어도 되지만, 채널 멤버십으로 참여자/정족수를 집계하려면 멤버 조회 권한이 필요하다.
5. 왼쪽 **OAuth2 -> URL Generator**:
   - **SCOPES**: `bot` 체크.
   - **BOT PERMISSIONS**: `View Channels`, `Send Messages`, `Read Message History` 체크.
6. 하단에 생성된 URL 을 브라우저에서 열어 봇을 **내 서버에 초대**한다.

## B. 채널 ID / 호스트 사용자 ID 얻기

1. Discord 앱 -> **설정 -> 고급 -> 개발자 모드 ON**.
2. 투표를 띄울 채널 우클릭 -> **채널 ID 복사** = `DISCORD_CHANNEL_ID`.
3. 호스트(폴백 결정권자)로 쓸 사용자를 우클릭 -> **사용자 ID 복사** = `HOST_USER_ID`.

## C. 프로젝트 설치 / 빌드

```bash
git clone <repo-url>
cd claude-council
npm install
npm run build      # tsc -> dist/ 생성 (council_vote 진입점 dist/mcp/server.js)
npm test           # 14 파일 98 테스트 green 확인 (선택)
```

## D. Claude 인증 (과금 주의)

`ANTHROPIC_API_KEY` 를 설정하면 종량 과금 경로를 탄다. Max/Pro 구독으로 추가 과금 없이 쓰려면 그 키를 **설정하지 말고**, 로컬에서 한 번 `claude /login` 으로 구독 OAuth 세션을 만들어 둔다. (CI 등 비대화형 환경은 `claude setup-token` 으로 `CLAUDE_CODE_OAUTH_TOKEN` 발급)

## E. council_vote MCP 서버 등록

투표 타임아웃(`VoteRules.timeoutMs`, 기본 180000ms)보다 **최소 30000ms 큰** 도구 타임아웃(`>= 210000`)을 줘야 3분 투표가 중간에 끊기지 않는다.

### 방법 1: `claude mcp add`

```bash
claude mcp add council-vote \
  --env DISCORD_TOKEN=<봇 토큰> \
  --env DISCORD_CHANNEL_ID=<채널 ID> \
  --env HOST_USER_ID=<호스트 사용자 ID> \
  -- node dist/mcp/server.js
```

### 방법 2: 프로젝트 `.mcp.json`

타임아웃 210000 = 180000 + 30000 버퍼. 비밀값은 셸 환경에서 주입하거나 직접 채운다.

```json
{
  "mcpServers": {
    "council-vote": {
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "timeout": 210000,
      "env": {
        "DISCORD_TOKEN": "",
        "DISCORD_CHANNEL_ID": "",
        "HOST_USER_ID": ""
      }
    }
  }
}
```

> `.env` 파일로도 값을 줄 수 있다. `cp .env.example .env` 후 값을 채우면 서버가 `dotenv` 로 읽는다. 단, MCP 등록의 `timeout` 은 `.mcp.json`/`claude mcp add` 쪽에서 지정해야 한다.

## F. Claude 가 council_vote 를 쓰도록 유도

MCP 도구는 내장 `AskUserQuestion` 을 강제로 막지 못한다(유도식). 팀 합의가 필요한 질문에서 Claude 가 `council_vote` 를 호출하도록 프로젝트 `CLAUDE.md` 에 다음을 추가한다.

```markdown
# 팀 의사결정
여러 사람이 공유하는 세션에서 객관식 결정 - 합의가 필요하면, 내장 AskUserQuestion 대신
council_vote MCP 도구를 호출해 Discord 투표로 합의를 받을 것.
```

## G. 동작 확인

1. 새 `claude` 세션을 연다.
2. `/mcp` 로 `council-vote` 가 connected 인지 확인한다.
3. 팀 결정이 필요한 질문을 던져 Claude 가 `council_vote` 를 호출하면, 지정 Discord 채널에 버튼 투표 메시지가 뜬다.

---

## 환경변수 정리

`loadConfig()` 가 `process.env`(또는 `.env`)에서 읽는다.

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `DISCORD_TOKEN` | 필수 | - | Discord 봇 토큰 (A-3) |
| `DISCORD_CHANNEL_ID` | 필수 | - | 투표를 띄울 채널 ID (B-2) |
| `HOST_USER_ID` | 필수 | - | 폴백 결정권을 가진 호스트 사용자 ID (B-3) |
| `VOTE_TIMEOUT_SECONDS` | 선택 | 180 | 투표 타임아웃(초). MCP 도구 타임아웃은 이 값 + 30초 이상 |
| `VOTE_QUORUM_RATIO` | 선택 | 0.5 | 정족수 비율(0-1), 기본 과반 |
| `ANTHROPIC_API_KEY` | 선택 | - | 설정 시 종량 과금. 구독 사용자는 비워둘 것 (D 참고) |

## 응답 형식

성공 시 `council_vote` 가 Claude 에 반환하는 텍스트(고정 4줄 템플릿):

```
Result: <winningLabel>
Outcome: <majority|tie|no-quorum|timeout|host-fallback>
Votes: <totalVotes>/<quorumTotal> (quorum <met|not met>)
Fallback: <none|host>
```

런타임 오류 시에는 4줄 템플릿 대신 `isError: true` 콘텐츠로 오류 메시지를 반환하며 프로세스를 종료하지 않는다(시작 시 로그인 실패만 fail-fast).

## 아키텍처

- 진입점: `src/mcp/server.ts` (thin shell) -> `src/mcp/bootstrap.ts` (DI 부팅 와이어링) -> `src/mcp/councilTool.ts` (핸들러 팩토리 + inputSchema)
- 코어 모듈(`council/tally.ts`, `council/canUseTool.ts` 의 `resolveCouncilDecision`, `discord/*`, `config.ts`, `council/types.ts`)은 그대로 import 해 재사용한다.
- 모든 진단 로그는 stderr 로만 출력한다. stdout 은 JSON-RPC 전용(오염 시 통신 깨짐).
- Discord 로그인은 서버 시작 시 1회 수행하고 프로세스 수명 동안 유지한다. 시작 로그인 실패 시 stderr 로그 후 `exit(1)` (fail-fast).
- 서버 와이어링은 의존성 주입(`bootstrap`)으로 분리해, login-once / fail-fast / 도구 등록 / transport 연결을 실제 Discord 접속 없이 단위 테스트한다.

```
src/
  config.ts               # loadConfig(): Discord 값 + VoteRules 로드
  council/
    types.ts              # CouncilQuestion, VoteRules, TallyResult 등 도메인 타입
    parseQuestion.ts      # 질문 파싱
    tally.ts              # 집계 (최다득표/정족수/동점/타임아웃 분류), DEFAULT_RULES
    canUseTool.ts         # resolveCouncilDecision (poll -> 집계 -> 호스트 폴백 오케스트레이션)
    session.ts            # (레거시 SDK 경로) 세션 처리
  discord/
    adapter.ts            # DiscordAdapter (poll/askHost), MessagingAdapter/VoteChannel 포트
    discordVoteChannel.ts # discord.js 연동 (라이브 카운트 edit)
    voteMessage.ts        # 버튼/임베드/푸터 메시지 구성
  mcp/
    councilTool.ts        # createCouncilVoteHandler 팩토리 + zod inputSchema
    bootstrap.ts          # DI 부팅 와이어링 (login/register/connect, fail-fast)
    server.ts             # MCP stdio 진입점 (실제 의존성 주입 thin shell)
  index.ts                # (레거시) Agent SDK canUseTool 래퍼 진입점
test/                     # 14 파일 98 테스트 (집계/타임아웃/폴백/MCP 핸들러/부팅 와이어링)
```

## 개발

```bash
npm install
cp .env.example .env   # 토큰/ID 채우기
npm run mcp            # tsx 로 MCP 서버 개발 실행
npm test               # 전체 테스트
npm run build          # 프로덕션 빌드 (dist/)
```

## 배포 모델

현재는 모델 A(팀마다 자기 봇 + 가이드 셋업)를 채택한다. 중앙 봇 호스팅(토큰 0개)인 모델 B 는 별도 작업으로 보류. 상세 결정 이력은 [docs/distribution-model.md](docs/distribution-model.md) 참고.

## 레거시 경로 (canUseTool)

초기 구현은 Agent SDK 의 `canUseTool` 콜백으로 `AskUserQuestion` 을 가로채 답을 주입하는 방식이었다(`src/index.ts`, `src/council/session.ts`). 이 경로는 Agent SDK `query()` 래퍼에서만 동작해, 표준 `claude` CLI/IDE 에서 쓰려고 MCP 도구 방식으로 전환했다. 레거시 코드는 테스트 의존으로 남겨 두었으며 메인 경로는 `council_vote` MCP 서버다.
