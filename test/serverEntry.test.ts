import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "discord.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../src/config.js";
import type { BootstrapDeps } from "../src/mcp/bootstrap.js";

// server.ts 가 import 시점에 bootstrapMcpServer 를 호출하므로,
// 실제 부팅(Discord 로그인 등)을 막기 위해 bootstrap 모듈을 mock 으로 가로챈다.
const { bootstrapSpy } = vi.hoisted(() => ({
  bootstrapSpy: vi.fn(async () => undefined),
}));
vi.mock("../src/mcp/bootstrap.js", () => ({
  bootstrapMcpServer: bootstrapSpy,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("server.ts (thin entry shell)", () => {
  it("실제 의존성(real discord.js Client / McpServer / StdioServerTransport / loadConfig / process.exit / console.error)을 주입해 bootstrap 을 한 번 호출한다", async () => {
    await import("../src/mcp/server.js");

    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
    const deps = bootstrapSpy.mock.calls[0][0] as BootstrapDeps;

    // loadConfig 는 실제 config.ts 구현 그대로 주입한다.
    expect(deps.loadConfig).toBe(loadConfig);

    // createClient 는 실제 discord.js Client 인스턴스를 만든다.
    const fakeConfig = {
      discordToken: "t",
      discordChannelId: "c",
      rules: { timeoutMs: 180_000, quorumRatio: 0.5, hostUserId: "h" },
    };
    expect(deps.createClient(fakeConfig)).toBeInstanceOf(Client);

    // createServer 는 실제 McpServer 인스턴스를 만든다.
    expect(deps.createServer()).toBeInstanceOf(McpServer);

    // createTransport 는 실제 StdioServerTransport 인스턴스를 만든다.
    expect(deps.createTransport()).toBeInstanceOf(StdioServerTransport);

    // exit 는 process.exit 로 위임한다.
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    deps.exit(2);
    expect(exitSpy).toHaveBeenCalledWith(2);

    // logError 는 console.error(stderr) 로 위임한다 (stdout 오염 금지).
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    deps.logError("진단 메시지", 1);
    expect(errSpy).toHaveBeenCalledWith("진단 메시지", 1);
  });

  it("부가 로직 없이 wiring 만 담당한다: 투표/도구/어댑터 로직을 직접 import 하지 않는다", () => {
    const source = readFileSync(
      new URL("../src/mcp/server.ts", import.meta.url),
      "utf8",
    );

    // 정확히 한 번 bootstrap 을 호출한다.
    const bootstrapCalls = source.match(/bootstrapMcpServer\s*\(/g) ?? [];
    expect(bootstrapCalls).toHaveLength(1);

    // 도구/어댑터/투표 집계 등 코어 로직은 bootstrap 으로 위임하고
    // 진입 셸은 직접 import/구현하지 않는다.
    expect(source).not.toMatch(/councilTool/);
    expect(source).not.toMatch(/DiscordAdapter/);
    expect(source).not.toMatch(/DiscordVoteChannel/);
    expect(source).not.toMatch(/registerTool/);
    expect(source).not.toMatch(/resolveCouncilDecision/);
    expect(source).not.toMatch(/\btally\b/);
  });
});
