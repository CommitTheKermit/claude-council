import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyFromEnv, resolveConfigPath } from "../src/setup/applyFromEnv.js";

describe("applyFromEnv", () => {
  it("환경변수 3개로 대상 경로에 council-vote 설정을 쓴다", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "council-env-"));
    const target = path.join(dir, "nested", "mcp.json"); // 없는 디렉토리도 생성돼야 함
    try {
      applyFromEnv({
        DISCORD_TOKEN: "tok",
        DISCORD_CHANNEL_ID: "chan",
        HOST_USER_ID: "host",
        COUNCIL_MCP_CONFIG_PATH: target,
      } as NodeJS.ProcessEnv);

      const cfg = JSON.parse(readFileSync(target, "utf8"));
      expect(cfg.mcpServers["council-vote"].env).toEqual({
        DISCORD_TOKEN: "tok",
        DISCORD_CHANNEL_ID: "chan",
        HOST_USER_ID: "host",
      });
      expect(cfg.mcpServers["council-vote"].command).toBe("npx");
      expect(cfg.mcpServers["council-vote"].timeout).toBe(210000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("필수 환경변수가 빠지면 예외를 던진다", () => {
    expect(() => applyFromEnv({ DISCORD_TOKEN: "only" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("resolveConfigPath 는 override 가 없으면 ~/.claude/mcp.json 을 가리킨다", () => {
    const p = resolveConfigPath({} as NodeJS.ProcessEnv);
    expect(p).toBe(path.join(os.homedir(), ".claude", "mcp.json"));
  });
});
