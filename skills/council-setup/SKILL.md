---
name: council-setup
description: claude-council 셋업 마법사. 비밀값(Discord 봇 토큰/채널 ID/호스트 ID)을 챗에 노출하지 않고 설정한다. 플러그인 설치는 OS 환경변수 + 번들 .mcp.json 의 ${VAR} 참조로, 수동 설치는 .env 를 읽는 러너로 ~/.claude/mcp.json 에 기록. 사용자가 "/council-setup", "council 셋업", "council-vote 설정" 같은 표현을 쓰면 발동.
---

# /council-setup 셋업 마법사

claude-council(모델 A: 팀마다 자기 봇)을 처음 켜는 사용자를 손잡고 안내한다.

## 보안 원칙 (최우선, 절대 위반 금지)

**비밀값(토큰)은 절대 대화/챗을 거치게 하지 않는다.**

- 사용자에게 토큰을 채팅에 붙여넣게 시키지 말 것.
- Bash 커맨드 문자열에 토큰 원문을 적지 말 것.
- 그 둘 다 대화 transcript 와 tool-call 로그에 영구히 남는다. 비밀값을 env 로 넘기는
  트릭은 셸 히스토리만 막을 뿐 대화 로그는 못 막고, 에이전트가 커맨드에 원문을 타이핑하면
  거기서 또 샌다.

비밀값은 **사용자 환경(OS 환경변수 또는 `.env`)에서만** 흐르고, 마법사는 값을 **읽지도
출력하지도 않는다.** 검증이 필요하면 값 원문 대신 "설정됨/미설정"이나 `maskSecret`(마지막
4자)만 보여준다.

이미 토큰이 대화에 노출됐다면 되돌릴 수 없으니, 해당 봇 토큰을 Discord 포털에서
**재발급(Reset Token)** 하도록 안내한다.

## 설치 경로 분기 (먼저 어느 쪽인지 판단)

| 경로 | 언제 | 비밀값이 사는 곳 |
|---|---|---|
| **A. 플러그인 설치 (권장)** | `claude plugin install` 로 깔았다 | 사용자 셸의 OS 환경변수. 번들 `.mcp.json` 이 `${DISCORD_TOKEN}` 으로 참조만 함 (리터럴 토큰 어디에도 없음) |
| **B. 수동/소스 설치** | 이 저장소를 클론해 직접 돌린다 | `~/.claude/mcp.json` 의 `env` 블록에 리터럴 (러너가 `.env`/env 에서 읽어 기록) |

저장소 루트에 `.mcp.json`(번들) 과 `.claude-plugin/plugin.json` 이 보이면 플러그인 경로다.
어느 쪽인지 모호하면 사용자에게 물어 정한다.

---

## 공통 1단계: Discord 봇 준비 (이미 있으면 건너뜀)
- https://discord.com/developers/applications 에서 Application 생성 -> Bot 추가
- 토큰 복사, SERVER MEMBERS Intent 켜기, 원클릭 초대 링크로 서버에 봇 추가
- 채널 ID: Discord 개발자 모드 ON 후 채널 우클릭 -> "채널 ID 복사"
- 호스트 ID: 호스트로 쓸 사용자 우클릭 -> "사용자 ID 복사"

---

## 경로 A: 플러그인 설치 (OS 환경변수 + `${VAR}` 참조)

번들 `.mcp.json` 이 비밀값을 리터럴로 갖지 않고 `${DISCORD_TOKEN}` 등으로 참조한다.
Claude Code 가 **자신이 기동된 셸의 환경변수**를 읽어 `${...}` 를 확장해 서버 프로세스에
주입한다. 따라서 사용자는 세 값을 **자기 셸 환경변수로** 두기만 하면 된다.

### A-1. export 세 줄을 셸 프로필에 추가하도록 안내 (Claude 는 값을 안 본다)
사용자에게 `~/.zshrc`(또는 `~/.bashrc`) 에 아래 세 줄을 **직접** 추가하고 실제 값을 채우라고
안내한다. 마법사는 값을 묻지도, 대신 적어주지도 않는다.

```bash
export DISCORD_TOKEN='여기에_봇_토큰'
export DISCORD_CHANNEL_ID='여기에_채널ID'
export HOST_USER_ID='여기에_호스트ID'
```

### A-2. 새 셸에서 "설정됐는지"만 확인 (값 출력 금지)
사용자가 **자기 터미널에서** 아래를 실행해 세 값이 비어있지 않은지만 확인하게 한다.
(마법사가 Claude 의 Bash 로 확인하면 Claude 세션의 환경이라 사용자 프로필 반영이 안 될 수
있으니, 사용자 본인 터미널에서 확인시킨다. 값 자체는 절대 echo 하지 않는다.)

```bash
for v in DISCORD_TOKEN DISCORD_CHANNEL_ID HOST_USER_ID; do
  [ -n "${!v}" ] && echo "$v: 설정됨" || echo "$v: 미설정"
done
```

### A-3. 그 환경에서 claude 재시작 후 확인
- **세 export 가 활성화된 터미널에서** `claude` 를 새로 띄운다(프로필을 source 한 새 셸).
- `/mcp` 로 `council-vote` 가 connected 인지 확인.
- 미설정 상태로 띄우면 `${DISCORD_TOKEN}` 미확장으로 서버가 못 뜨거나 로그인 실패 로그가
  stderr 로 나온다 -> A-1 로 돌아가 환경변수부터 채우게 안내.

> 핵심: 토큰이 플러그인에도, `~/.claude/mcp.json` 에도 리터럴로 남지 않는다. 오직 사용자
> 셸 환경에만 있다.

---

## 경로 B: 수동/소스 설치 (러너가 `~/.claude/mcp.json` 에 기록)

플러그인 없이 이 저장소를 직접 돌리는 경우. 설정 쓰기는 손으로 JSON 을 만들지 말고
**반드시 검증된 모듈 `src/setup/configWriter.ts`(러너 `src/setup/applyFromEnv.ts`)를 호출**한다.
(마스킹/백업/all-or-nothing/병합이 단위 테스트로 보장됨)

### B-1. 기존 설정 확인 (충돌 처리)
`~/.claude/mcp.json` 을 읽어 `council-vote` 엔트리가 이미 있으면, 기존 `env` 값을
**마스킹해서**(`maskSecret`, 마지막 4자만) 보여주고 덮어쓸지 확인받는다. 거부하면 중단한다.

### B-2. 값을 `.env` 에 직접 적게 안내 (Claude 는 값을 보지 않는다)
세 값을 **챗으로 묻지 않는다.** 사용자가 프로젝트 루트 `.env` 에 직접 적게 안내한다.
(`.env` 가 없으면 `cp .env.example .env`)

- `DISCORD_TOKEN=...` / `DISCORD_CHANNEL_ID=...` / `HOST_USER_ID=...`

> `.env` 는 `.gitignore` 에 포함돼 커밋되지 않는지 먼저 확인할 것.
사용자가 "다 적었다"고 하면 다음으로 간다. 마법사가 `.env` 를 열어 값을 화면에 보이지 않는다.

### B-3. 러너를 blind 실행
출판된 `council-setup` bin 을 **인자 없이** 실행한다. 러너가 `import "dotenv/config"` 로
현재 디렉토리의 `.env` 를 읽어 읽기 -> 파싱 -> 병합 -> `.bak` 백업 -> 1회 쓰기를 수행한다.
다른 서버는 보존되고, 깨진 JSON 이면 예외를 던지고 아무것도 쓰지 않는다.

```bash
npx -y -p claude-council council-setup
```

세 값이 없으면 러너가 예외를 던지고 종료한다(all-or-nothing). 이때 `.env` 를 다시 확인하라고
안내한다 - 토큰을 챗으로 받아 대신 넣어주지 않는다. 검증은 mcp.json 의 env 를 마스킹해서만
보여준다.

> 이 저장소 소스에서 직접 돌릴 때는 `npx tsx src/setup/applyFromEnv.ts`
> (빌드본은 `npm run build` 후 `node dist/setup/applyFromEnv.js`).
> 토큰이 `.env` 가 아닌 OS 환경변수에 이미 export 돼 있으면 그 값이 `.env` 보다 우선한다
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

### B-4. 마무리
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
