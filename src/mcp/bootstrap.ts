import type { AppConfig } from "../config.js";
import { DiscordAdapter } from "../discord/adapter.js";
import { DiscordVoteChannel } from "../discord/discordVoteChannel.js";
import {
  COUNCIL_VOTE_TOOL_NAME,
  councilVoteInputShape,
  createCouncilVoteHandler,
} from "./councilTool.js";

// discord.js Client 의 최소 표면 (로그인 + 채널 접근). 테스트는 fake 로 주입한다.
export interface DiscordClientLike {
  login(token: string): Promise<unknown>;
  channels: { fetch(id: string): Promise<unknown> };
}

// McpServer 의 최소 표면 (도구 등록 + 트랜스포트 연결).
export interface McpServerLike {
  registerTool(
    name: string,
    config: { title?: string; description?: string; inputSchema?: unknown },
    cb: (...args: unknown[]) => unknown,
  ): unknown;
  connect(transport: unknown): Promise<void>;
}

/**
 * bootstrapMcpServer 의 주입 의존성 (Dependency Inversion).
 * 실제 구현(server.ts)과 테스트용 fake 를 동일 인터페이스로 갈아끼울 수 있게 한다.
 */
export interface BootstrapDeps {
  loadConfig: () => AppConfig;
  createClient: (config: AppConfig) => DiscordClientLike;
  login: (client: DiscordClientLike, token: string) => Promise<unknown>;
  createServer: () => McpServerLike;
  createTransport: () => unknown;
  exit: (code: number) => void;
  logError: (...args: unknown[]) => void;
}

/**
 * MCP stdio 서버를 부팅한다 (config 로드 -> Discord 로그인 -> 도구 등록 -> 트랜스포트 연결).
 *
 * fail-fast: 시작 시 Discord 로그인이 실패하면 stderr 로 오류를 남기고 exit(1) 을 호출하며
 * 도구 등록/트랜스포트 연결을 하지 않는다. 로그인은 서버 시작 시 한 번만 수행하고
 * 프로세스 수명 동안 유지한다.
 */
export async function bootstrapMcpServer(deps: BootstrapDeps): Promise<void> {
  const config = deps.loadConfig();
  const client = deps.createClient(config);

  // 시작 로그인 (한 번). 실패 시 fail-fast.
  try {
    await deps.login(client, config.discordToken);
  } catch (err) {
    deps.logError("[council-mcp] Discord 로그인 실패, 서버를 종료합니다:", err);
    deps.exit(1);
    return; // exit 가 종료하지 않는 fake 환경에서도 더 진행하지 않는다.
  }

  // 로그인 성공 후에만 도구를 등록하고 트랜스포트를 연결한다.
  const channel = new DiscordVoteChannel(client as never, config.discordChannelId);
  const adapter = new DiscordAdapter(channel, config.rules.timeoutMs);
  const handler = createCouncilVoteHandler(adapter, config.rules);

  const server = deps.createServer();
  server.registerTool(
    COUNCIL_VOTE_TOOL_NAME,
    {
      title: "Council Vote",
      description:
        "팀에게 객관식 질문을 Discord 버튼 투표로 보내 합의된 답을 받아온다. " +
        "Claude가 사용자/팀의 선택이 필요할 때 이 도구를 호출한다.",
      inputSchema: councilVoteInputShape,
    },
    handler as (...args: unknown[]) => unknown,
  );

  const transport = deps.createTransport();
  await server.connect(transport);
}
