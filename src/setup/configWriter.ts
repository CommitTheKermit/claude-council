import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// council-vote MCP 서버 엔트리 형태. ~/.claude/mcp.json 의 mcpServers.council-vote 에 들어간다.
export interface CouncilEntry {
  command: string;
  args: string[];
  timeout: number;
  env: Record<string, string>;
}

// mcp.json 전체 구조. council-vote 외 다른 서버 항목도 보존된다.
export interface McpConfig {
  mcpServers: Record<string, unknown>;
  [key: string]: unknown;
}

// council-vote 엔트리를 구성하는 비밀/식별 값.
export interface CouncilSecrets {
  discordToken: string;
  discordChannelId: string;
  hostUserId: string;
}

export const COUNCIL_SERVER_KEY = "council-vote";
export const COUNCIL_TIMEOUT_MS = 210_000;

// 비밀값 마스킹: 길이>4 면 마지막 4자만 남기고 앞부분을 *로, 길이<=4 면 전체를 *로 대체한다.
export function maskSecret(secret: string): string {
  if (secret.length <= 4) {
    return "*".repeat(secret.length);
  }
  const visible = secret.slice(-4);
  const masked = "*".repeat(secret.length - 4);
  return masked + visible;
}

// council-vote MCP 엔트리 객체를 생성한다. command=npx, args=['-y','claude-council'], timeout=210000.
export function buildCouncilEntry(secrets: CouncilSecrets): CouncilEntry {
  return {
    command: "npx",
    args: ["-y", "claude-council"],
    timeout: COUNCIL_TIMEOUT_MS,
    env: {
      DISCORD_TOKEN: secrets.discordToken,
      DISCORD_CHANNEL_ID: secrets.discordChannelId,
      HOST_USER_ID: secrets.hostUserId,
    },
  };
}

// JSON 문자열을 McpConfig로 파싱한다. 빈 입력은 기본값(빈 mcpServers), 깨진 JSON은 예외를 던진다.
export function parseConfig(raw: string): McpConfig {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { mcpServers: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `mcp.json 파싱 실패: 손상된 JSON 입니다. 자동 수정하지 않습니다. (${(err as Error).message})`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("mcp.json 파싱 실패: 최상위가 객체가 아닙니다.");
  }
  const config = parsed as McpConfig;
  if (typeof config.mcpServers !== "object" || config.mcpServers === null || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }
  return config;
}

// 기존 설정에 council-vote 엔트리를 병합한다. 다른 서버 항목은 그대로 보존한다.
export function mergeCouncilEntry(config: McpConfig, entry: CouncilEntry): McpConfig {
  return {
    ...config,
    mcpServers: {
      ...config.mcpServers,
      [COUNCIL_SERVER_KEY]: entry,
    },
  };
}

// 완성된 설정 객체를 받아 백업 후 1회만 쓴다(all-or-nothing).
// 디렉토리가 없으면 생성하고, 기존 파일이 있으면 같은 경로 + '.bak' 로 백업한다.
export function writeConfigWithBackup(filePath: string, config: McpConfig): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (existsSync(filePath)) {
    copyFileSync(filePath, `${filePath}.bak`);
  }
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  writeFileSync(filePath, serialized, "utf8");
}

// 파일을 읽어 council-vote 엔트리를 병합 저장하는 고수준 헬퍼.
// 깨진 JSON 보호: 읽은 내용이 손상되면 parseConfig가 예외를 던지고 쓰기를 수행하지 않는다.
export function applyCouncilConfig(filePath: string, secrets: CouncilSecrets): McpConfig {
  const raw = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const config = parseConfig(raw);
  const entry = buildCouncilEntry(secrets);
  const merged = mergeCouncilEntry(config, entry);
  writeConfigWithBackup(filePath, merged);
  return merged;
}
