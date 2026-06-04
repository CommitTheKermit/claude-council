# 배포 모델 결정 (Distribution Model)

claude-council을 사용자에게 어떻게 배포하고, Discord 봇 자격증명을 어떻게 주입할지에 대한 결정 기록.

## 결정

- **현재 채택: 모델 A (팀마다 자기 봇 + 가이드 셋업 마법사)**
- **나중에 고려: 모델 B (중앙 봇 호스팅, 사용자 토큰 0개)**
- 적용 순서: MCP 코어(council_vote) 동작 검증 -> 플러그인 포장 -> 셋업 마법사. 모델 B는 별도 프로젝트급 작업으로 보류.

## 배경: 왜 갈림길이 생기나

핵심 마찰은 "Discord 봇 토큰을 누가/어떻게 만드느냐"이다. 봇 토큰은 자동으로 얻을 수 없고, 누군가 한 번은 Discord 개발자 포털에서 봇을 등록해야 한다. 이 "한 번"을 각 팀이 하느냐(A), 메인테이너가 한 번 하고 서비스로 공유하느냐(B)가 갈림길.

## 모델 A: 팀마다 자기 봇 (가이드 마법사로 쉽게) - 채택

각 팀이 자기 봇을 만들되, `/council-setup` 스킬이 10단계 포털 작업을 손잡고 안내한다.

- "이 링크 열어 -> Bot 추가 -> 토큰 복사해 여기 붙여넣기" 식 Q&A
- 권한/인텐트가 미리 박힌 원클릭 초대 링크 제공
- 입력받은 토큰으로 테스트 로그인 + 채널 접근 검증 후 설정 파일 자동 작성

장점:
- 추가 서버 인프라 없음
- 각 팀 데이터가 자기 봇 안에만 머묾 (프라이버시)
- 오픈소스 Discord 도구 표준 방식
- 현재 설계(각 MCP가 Discord에 직접 로그인)와 그대로 호환

한계:
- 한 사람이 한 번은 약 3분 봇 생성을 해야 함 (마법사가 있으면 부담 작음)

## 모델 B: 중앙 봇 호스팅 (사용자 토큰 0개) - 나중에 고려

메인테이너가 봇 하나를 등록해 서비스로 상시 운영. 사용자는 "내 서버에 봇 초대" 링크 클릭 + 채널 ID만 제공.

장점:
- 끝판왕 편의성 (토큰/개발자 포털 불필요)

대가:
- 서버를 직접 호스팅/유지해야 함 (상시 가동)
- 아키텍처 재설계 필요: 현재는 각 MCP가 Discord에 직접 로그인하지만, 중앙 봇이면 MCP는 "투표 시작/결과 대기"를 중앙 봇의 HTTP API로 호출하는 구조로 바꿔야 함 -> 코어 변경 + 새 서버 코드
- 모든 팀의 투표가 메인테이너 봇을 거침 (프라이버시/신뢰 이슈)
- 토큰 1개 공유의 운영 리스크

결론: "토큰 0개"의 모델 B는 사실상 별개의 더 큰 프로젝트(호스팅 서비스)다.

## 셋업 마법사 (`/council-setup`) - 모델 A의 핵심 편의 장치

`ooo setup`과 같은 방식: Claude Code 안에서 도는 가이드 스킬/슬래시 커맨드. 사용자에게 단계별로 질문하고 Bash로 설정 파일을 써주는 온보딩 마법사.

비밀값 주입 방식의 3번째 해법으로, 사용자가 토큰/채널 ID를 입력하는 순간 `.mcp.json` env 블록(또는 설정 파일)에 직접 써준다. 이 마법사는 플러그인 봉지 안에 MCP 서버와 함께 동봉한다 (포장 phase 산출물).

## Discord 자격증명 획득 난이도 (참고 사실)

두 값의 성격이 다르다:

### 봇 토큰 - 개발자 등록 필요 (자동으로 못 얻음)
- discord.com/developers/applications 에서 Application 생성 -> Bot 추가 -> 토큰 복사
- 봇을 서버에 초대 (OAuth2 URL, 권한 scope 지정)
- claude-council은 채널 멤버십 인증을 쓰므로 포털에서 SERVER MEMBERS Intent(특권 인텐트)를 켜야 함. 버튼 투표 자체(interaction)는 특권 인텐트 불필요하지만, 참여자/정족수 집계로 멤버를 보려면 필요할 수 있음
- 즉 누군가 한 번은 개발자 작업을 해야 함

### 채널 ID - 쉬움 (개발자 모드 토글만)
- Discord 설정 -> 고급 -> 개발자 모드 ON -> 채널 우클릭 -> "채널 ID 복사"
- 또는 브라우저에서 채널 열면 URL에 ID가 그대로 보임
- 토글 하나면 끝, 코딩 지식 불필요

## 플러그인 포장 구성요소 (포장 phase 메모)

- `.claude-plugin/plugin.json` (매니페스트: name/version/description, `skills` 필드로 `./.claude/skills` 가리킴) - 작성됨
- 번들 `.mcp.json` (repo 루트, council-vote `npx -y claude-council` + timeout: 210000) - 작성됨
- 배포용 marketplace (marketplace.json 호스팅) -> 팀원은 `claude plugin marketplace add` + `claude plugin install`
- `skills/` 또는 CLAUDE.md 유도문 동봉 (council_vote 호출 유도)
- `/council-setup` 셋업 마법사 스킬

## 비밀값 주입: 채택안 (설계 A - OS 환경변수 + `${VAR}` 참조)

비밀값(토큰/채널 ID/호스트 ID)은 플러그인에 담아 배포 불가. 두 경로로 갈린다.

- **플러그인 설치 경로 (채택, 권장)**: 번들 `.mcp.json` 의 `env` 가 `${DISCORD_TOKEN}` 등
  **참조만** 담고 리터럴 토큰은 어디에도 없다. 설치자는 셸 프로필에 `export` 세 줄을 두고,
  Claude Code 가 기동 셸의 환경변수를 읽어 `${...}` 를 확장해 서버에 주입한다. ouroboros 가
  `ANTHROPIC_API_KEY` 를 사용자 환경에 두고 mcp.json 에 리터럴을 안 박는 것과 같은 결.
  (Claude Code `.mcp.json` 은 command/args/env/url/headers 에서 `${VAR}`, `${VAR:-default}` 확장 지원.)
- **수동/소스 경로**: `/council-setup` 마법사가 `.env`/env 에서 읽어 `~/.claude/mcp.json` 의
  `env` 블록에 리터럴로 기록(러너 `src/setup/applyFromEnv.ts`, dotenv 로드).

공통 원칙: 토큰을 챗/대화에 절대 통과시키지 않는다(transcript·tool-call 로그 영구 노출 방지).
