---
name: council-setup
description: claude-council 셋업 마법사. Discord 봇 토큰/채널 ID/호스트 사용자 ID를 단계별로 입력받아 ~/.claude/mcp.json 의 council-vote MCP 엔트리를 안전하게(백업, all-or-nothing, 비밀값 마스킹) 작성한다. 사용자가 "/council-setup", "council 셋업", "council-vote 설정" 같은 표현을 쓰면 발동.
---

# /council-setup 셋업 마법사

claude-council(모델 A: 팀마다 자기 봇)을 처음 켜는 사용자를 손잡고 안내한다.
입력받은 비밀값으로 `~/.claude/mcp.json` 의 `mcpServers.council-vote` 엔트리를 작성한다.

설정 쓰기는 직접 손으로 JSON을 만들지 말고 **반드시 검증된 모듈
`src/setup/configWriter.ts`(러너 `src/setup/applyFromEnv.ts`)를 호출**한다.
(마스킹/백업/all-or-nothing/병합이 단위 테스트로 보장됨)

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

### 3. 값 입력받기
세 값을 순서대로 묻는다. (한 번에 하나씩, 입력 즉시 마스킹해 되읽어 준다)

- `DISCORD_TOKEN` (봇 토큰)
- `DISCORD_CHANNEL_ID` (투표 채널 ID)
- `HOST_USER_ID` (호스트/타이브레이크 사용자 ID)

세 값을 다 모으기 전에는 파일을 건드리지 않는다(all-or-nothing). 중간 취소 시 그대로 종료.

### 4. 설정 파일 작성
세 값을 **환경변수로 전달**해(셸 히스토리/프로세스 목록에 토큰이 남지 않도록)
러너를 한 번 실행한다. 러너가 읽기 -> 파싱 -> 병합 -> `.bak` 백업 -> 1회 쓰기를 수행한다.
기존 `mcpServers` 의 다른 서버는 보존되고, 깨진 JSON 이면 예외를 던지고 아무것도 쓰지 않는다.

```bash
DISCORD_TOKEN='<토큰>' \
DISCORD_CHANNEL_ID='<채널ID>' \
HOST_USER_ID='<호스트ID>' \
npx tsx src/setup/applyFromEnv.ts
```

> 빌드본으로 돌리려면 `npm run build` 후 `... node dist/setup/applyFromEnv.js`.

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
