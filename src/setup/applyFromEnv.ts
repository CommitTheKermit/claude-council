#!/usr/bin/env node
// 프로젝트 루트의 .env 를 자동 로드한다. 사용자는 비밀값을 .env 에 직접 적어두고,
// 마법사/Claude 는 그 값을 보거나 출력하지 않고 이 러너만 실행한다(대화 로그 노출 방지).
// 명시적으로 넘긴 process.env 가 .env 보다 우선한다(dotenv 는 기존 값을 덮지 않음).
import "dotenv/config";
import os from "node:os";
import path from "node:path";
import { applyCouncilConfig, type McpConfig } from "./configWriter.js";

// 대상 mcp.json 경로를 정한다. COUNCIL_MCP_CONFIG_PATH 로 덮어쓸 수 있다(테스트용).
export function resolveConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.COUNCIL_MCP_CONFIG_PATH ?? path.join(os.homedir(), ".claude", "mcp.json");
}

// 환경변수에서 비밀값을 읽어 council-vote 설정을 기록한다. 셋업 마법사(/council-setup)가 호출한다.
// 비밀값을 argv 가 아닌 env 로 받아 셸 히스토리/프로세스 목록 노출을 피한다.
export function applyFromEnv(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const discordToken = env.DISCORD_TOKEN;
  const discordChannelId = env.DISCORD_CHANNEL_ID;
  const hostUserId = env.HOST_USER_ID;
  if (!discordToken || !discordChannelId || !hostUserId) {
    throw new Error(
      "DISCORD_TOKEN, DISCORD_CHANNEL_ID, HOST_USER_ID 를 모두 환경변수로 주세요.",
    );
  }
  return applyCouncilConfig(resolveConfigPath(env), {
    discordToken,
    discordChannelId,
    hostUserId,
  });
}

// tsx/node 로 직접 실행되면 적용하고 작성 경로를 stderr 로 알린다(stdout 오염 방지).
// 가드: 비밀값(토큰/ID)은 절대 stdout/stderr 로 출력하지 않는다. 작성 결과는 "경로"만 알린다.
// 노출 검증이 필요하면 호출 측이 configWriter 의 maskSecret 으로 가려서만 보여줄 것.
const directPath = process.argv[1];
if (directPath && import.meta.url === `file://${directPath}`) {
  applyFromEnv();
  console.error(`[council-setup] 설정을 작성했습니다: ${resolveConfigPath()}`);
}
