---
name: council-setup
description: claude-council 셋업 마법사. Discord 봇 토큰/채널 ID/호스트 사용자 ID를 단계별로 입력받아 ~/.claude/mcp.json 의 council-vote MCP 엔트리를 안전하게(백업, all-or-nothing, 비밀값 마스킹) 작성한다. 사용자가 "/council-setup", "council 셋업", "council-vote 설정" 같은 표현을 쓰면 발동.
---

# /council-setup 셋업 마법사

claude-council(모델 A: 팀마다 자기 봇)을 처음 켜는 사용자를 손잡고 안내한다.
Discord 개발자 포털 작업을 단계별로 도운 뒤, 입력받은 비밀값으로
`~/.claude/mcp.json` 의 `mcpServers.council-vote` 엔트리를 작성한다.

설정 쓰기 로직은 직접 손으로 JSON을 만들지 말고
**반드시 `src/setup/configWriter.ts` 모듈을 호출**한다.
(순수 함수 + fs 함수가 분리되어 있고 백업/all-or-nothing/마스킹이 보장됨)

## 단계

### 1. Discord 봇 준비 안내
- https://discord.com/developers/applications 에서 Application 생성 -> Bot 추가
- 토큰 복사, SERVER MEMBERS Intent 켜기, 원클릭 초대 링크로 서버에 봇 추가
- 채널 ID 는 Discord 개발자 모드 ON 후 채널 우클릭 -> "채널 ID 복사"

### 2. 값 입력받기
사용자에게 3가지를 순서대로 묻는다(입력 즉시 화면에는 마스킹해 되읽어 준다).

- `DISCORD_TOKEN` (봇 토큰)
- `DISCORD_CHANNEL_ID` (투표 채널 ID)
- `HOST_USER_ID` (호스트/타이브레이크 사용자 ID)

확인 출력 시 `maskSecret` 으로 가린다:

```ts
import { maskSecret } from "../../src/setup/configWriter.js";
console.error(`DISCORD_TOKEN = ${maskSecret(token)}`); // 진단 로그는 stderr
```

### 3. 설정 파일 작성
`applyCouncilConfig` 한 번으로 읽기 -> 파싱 -> 병합 -> 백업 -> 1회 쓰기를 수행한다.
기존 `mcpServers` 의 다른 서버 항목은 보존되고, 같은 경로 `+ .bak` 백업이 생긴다.
깨진 JSON 이면 예외를 던지고 아무것도 쓰지 않는다(all-or-nothing).

```ts
import os from "node:os";
import path from "node:path";
import { applyCouncilConfig } from "../../src/setup/configWriter.js";

const filePath = path.join(os.homedir(), ".claude", "mcp.json");
applyCouncilConfig(filePath, {
  discordToken,
  discordChannelId,
  hostUserId,
});
```

생성되는 엔트리:

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

### 4. 마무리 안내
- Claude Code 재시작 후 `council_vote` MCP 도구가 보이는지 확인
- 토큰이 틀렸으면 봇 로그인 실패 로그가 stderr 로 출력됨

## 모듈 함수 참조 (`src/setup/configWriter.ts`)

- `maskSecret(secret)` - 길이>4 면 마지막 4자만 노출, 길이<=4 면 전체 마스킹
- `buildCouncilEntry(secrets)` - council-vote 엔트리 객체 생성
- `parseConfig(raw)` - 빈 입력은 기본값, 깨진 JSON 은 예외
- `mergeCouncilEntry(config, entry)` - 다른 서버 보존하며 병합
- `writeConfigWithBackup(filePath, config)` - 백업 후 디렉토리 생성 + 1회 쓰기
- `applyCouncilConfig(filePath, secrets)` - 위 단계를 묶은 고수준 헬퍼
