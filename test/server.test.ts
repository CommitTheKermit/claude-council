import { describe, it, expect, vi } from "vitest";
import {
  bootstrapMcpServer,
  type BootstrapDeps,
  type DiscordClientLike,
  type McpServerLike,
} from "../src/mcp/bootstrap.js";
import type { AppConfig } from "../src/config.js";

const config: AppConfig = {
  discordToken: "token-123",
  discordChannelId: "channel-123",
  rules: { timeoutMs: 180_000, quorumRatio: 0.5, hostUserId: "host-1" },
};

// registerTool/connect 호출을 기록하는 fake McpServer.
function fakeServer() {
  const registered: { name: string; config: Record<string, unknown> }[] = [];
  const connected: unknown[] = [];
  const server: McpServerLike = {
    registerTool: (name, cfg) => {
      registered.push({ name, config: cfg as Record<string, unknown> });
      return {};
    },
    connect: async (transport) => {
      connected.push(transport);
    },
  };
  return { server, registered, connected };
}

function fakeClient(): DiscordClientLike {
  return {
    login: async () => undefined,
    channels: { fetch: async () => undefined },
  };
}

function makeDeps(overrides: Partial<BootstrapDeps>): {
  deps: BootstrapDeps;
  spies: {
    login: ReturnType<typeof vi.fn>;
    exit: ReturnType<typeof vi.fn>;
    logError: ReturnType<typeof vi.fn>;
  };
} {
  const login = vi.fn(async () => undefined);
  const exit = vi.fn();
  const logError = vi.fn();
  const deps: BootstrapDeps = {
    loadConfig: () => config,
    createClient: () => fakeClient(),
    login,
    createServer: () => fakeServer().server,
    createTransport: () => ({ kind: "stdio" }),
    exit,
    logError,
    ...overrides,
  };
  return { deps, spies: { login, exit, logError } };
}

describe("bootstrapMcpServer (DI wiring)", () => {
  it("로그인은 한 번만 수행하고 council_vote 도구를 등록한 뒤 트랜스포트에 연결한다", async () => {
    const { server, registered, connected } = fakeServer();
    const { deps, spies } = makeDeps({ createServer: () => server });

    await bootstrapMcpServer(deps);

    expect(spies.login).toHaveBeenCalledTimes(1);
    expect(spies.login).toHaveBeenCalledWith(expect.anything(), "token-123");
    expect(registered).toHaveLength(1);
    expect(registered[0].name).toBe("council_vote");
    expect(registered[0].config.inputSchema).toBeDefined();
    expect(connected).toHaveLength(1);
    expect(spies.exit).not.toHaveBeenCalled();
  });

  it("시작 로그인 실패 시 fail-fast: stderr 로그 + exit(1), 도구 등록/연결 없음", async () => {
    const { server, registered, connected } = fakeServer();
    const login = vi.fn(async () => {
      throw new Error("로그인 거부");
    });
    const { deps, spies } = makeDeps({
      createServer: () => server,
      login,
    });

    await bootstrapMcpServer(deps);

    expect(spies.exit).toHaveBeenCalledWith(1);
    expect(spies.logError).toHaveBeenCalled();
    expect(registered).toHaveLength(0);
    expect(connected).toHaveLength(0);
  });

  it("등록된 inputSchema 는 question/header/options 키를 가진다", async () => {
    const { server, registered } = fakeServer();
    const { deps } = makeDeps({ createServer: () => server });

    await bootstrapMcpServer(deps);

    const shape = registered[0].config.inputSchema as Record<string, unknown>;
    expect(Object.keys(shape).sort()).toEqual(["header", "options", "question"]);
  });
});
