---
name: council-setup
description: claude-council 셋업 마법사. 사용자가 .env 에 적어둔 Discord 봇 토큰/채널 ID/호스트 사용자 ID를 (Claude 가 값을 보지 않고) 러너로 읽어 ~/.claude/mcp.json 의 council-vote MCP 엔트리를 안전하게(백업, all-or-nothing, 비밀값은 챗 비경유) 작성한다. 사용자가 "/council-setup", "council 셋업", "council-vote 설정" 같은 표현을 쓰면 발동.
---

# /council-setup 셋업 마법사

claude-council(모델 A: 팀마다 자기 봇)을 처음 켜는 사용자를 손잡고 안내한다.
입력받은 비밀값으로 `~/.claude/mcp.json` 의 `mcpServers.council-vote` 엔트리를 작성한다.

설정 쓰기는 직접 손으로 JSON을 만들지 말고 **반드시 검증된 모듈
`src/setup/configWriter.ts`(러너 `src/setup/applyFromEnv.ts`)를 호출**한다.
(마스킹/백업/all-or-nothing/병합이 단위 테스트로 보장됨)

## 보안 원칙 (최우선, 절대 위반 금지)

**비밀값(토큰)은 절대 대화/챗을 거치게 하지 않는다.**

- 사용자에게 토큰을 채팅에 붙여넣게 시키지 말 것.
- Bash 커맨드 문자열에 토큰 원문을 적지 말 것.
- 그 둘 다 대화 transcript 와 tool-call 로그에 영구히 남는다. 비밀값을 env 로 넘기는
  트릭은 셸 히스토리만 막을 뿐 대화 로그는 못 막고, 에이전트가 커맨드에 원문을 타이핑하면
  거기서 또 샌다.

대신 사용자가 **자기 손으로 프로젝트 루트 `.env` 에 값을 적어두고**, 마법사는 그 값을
**읽지도 출력하지도 않은 채** 러너만 실행한다. 러너가 `import "dotenv/config"` 로 `.env` 를
읽어 작성한다.

이미 토큰이 대화에 노출됐다면 되돌릴 수 없으니, 해당 봇 토큰을 Discord 포털에서
**재발급(Reset Token)** 하도록 안내한다.

## 단계

### 1. Discord 봇 준비 안내 (이미 있으면 건너뜀)
- https://discord.com/developers/applications 에서 Application 생성 -> Bot 추가
- 토큰 복사, SERVER MEMBERS Intent 켜기, 원클릭 초대 링크로 서버에 봇 추가
- 채널 ID: Discord 개발자 모드 ON 후 채널 우클릭 -> "채널 ID 복사"
- 호스트 ID: 호스트로 쓸 사용자 우클릭 -> "사용자 ID 복사"

### 2. 기존 설정 확인 (충돌 처리)
`~/.claude/mcp.json` 을 읽어 `council-vote` 엔트리가 이미 있으면, 기존 `env` 값을
**마스킹해서**(마지막 4자만 노출) 보여주고 덮어쓸지 사용자에게 확인받는다.
확인 표시는 `maskSecret` 으로 가린다. 사용자가 거부하면 중단한다.

### 3. 값을 `.env` 에 직접 적게 안내 (Claude 는 값을 보지 않는다)
세 값을 **챗으로 묻지 않는다.** 대신 사용자가 프로젝트 루트 `.env` 에 직접 적게 안내한다.
(`.env` 가 없으면 `.env.example` 을 복사: `cp .env.example .env`)

사용자에게 `.env` 에 아래 세 줄을 채우라고 안내한다(값은 사용자만 입력, Claude 는 그 값을
요청하지도 화면에 출력하지도 않는다):

- `DISCORD_TOKEN=...` (봇 토큰)
- `DISCORD_CHANNEL_ID=...` (투표 채널 ID)
- `HOST_USER_ID=...` (호스트/타이브레이크 사용자 ID)

> `.env` 는 `.gitignore` 에 포함돼 커밋되지 않는지 먼저 확인할 것.

사용자가 "다 적었다"고 하면 다음 단계로 간다. 마법사가 직접 `.env` 를 열어 값을 읽어
화면에 보여주지 않는다.

### 4. 설정 파일 작성 (러너를 blind 실행)
러너를 **인자 없이** 한 번 실행한다. 러너가 `import "dotenv/config"` 로 `.env` 를 읽어
읽기 -> 파싱 -> 병합 -> `.bak` 백업 -> 1회 쓰기를 수행한다. 기존 `mcpServers` 의 다른 서버는
보존되고, 깨진 JSON 이면 예외를 던지고 아무것도 쓰지 않는다.

```bash
npx tsx src/setup/applyFromEnv.ts
```

세 값이 `.env` 에 없으면 러너가 "DISCORD_TOKEN, DISCORD_CHANNEL_ID, HOST_USER_ID 를 모두
환경변수로 주세요" 예외를 던지고 종료한다(all-or-nothing). 이때 사용자에게 `.env` 를 다시
확인하라고 안내한다 - 토큰을 챗으로 받아 대신 넣어주지 않는다.

작성 후 검증이 필요하면 mcp.json 의 env 값을 **마스킹(`maskSecret`, 마지막 4자만)** 해서만
보여준다. 원문을 그대로 출력하지 않는다.

> 빌드본으로 돌리려면 `npm run build` 후 `node dist/setup/applyFromEnv.js`.
> 토큰이 이미 `.env` 가 아닌 OS 환경변수에 export 돼 있다면 그 값이 `.env` 보다 우선한다
> (dotenv 는 기존 `process.env` 를 덮지 않음).

작성되는 엔트리:

```json
{
  "mcpServers": {
    "council-vote": {
      "command": "npx",
      "args": ["-y", "claude-council"],
      "timeout": 210000,
      "env": {
        "DISCORD_TOKEN": "...",
        "DISCORD_CHANNEL_ID": "...",
        "HOST_USER_ID": "..."
      }
    }
  }
}
```

### 5. 마무리 안내
- "완료! `claude` 세션을 **재시작**한 뒤 `/mcp` 로 `council-vote` 가 connected 인지 확인하세요."
- 마법사는 파일 작성 + 안내까지만 한다. MCP 재연결/도구 호출 검증은 하지 않는다.
- 토큰이 틀렸으면 다음 세션에서 봇 로그인 실패 로그가 stderr 로 출력된다.

## 모듈 함수 참조 (`src/setup/configWriter.ts`)

- `maskSecret(secret)` - 길이>4 면 마지막 4자만 노출, 길이<=4 면 전체 마스킹
- `buildCouncilEntry(secrets)` - council-vote 엔트리 객체 생성
- `parseConfig(raw)` - 빈 입력은 기본값, 깨진 JSON 은 예외
- `mergeCouncilEntry(config, entry)` - 다른 서버 보존하며 병합
- `writeConfigWithBackup(filePath, config)` - 백업 후 디렉토리 생성 + 1회 쓰기
- `applyCouncilConfig(filePath, secrets)` - 위 단계를 묶은 고수준 헬퍼
- `applyFromEnv(env)` (`applyFromEnv.ts`) - 환경변수에서 읽어 적용하는 러너
