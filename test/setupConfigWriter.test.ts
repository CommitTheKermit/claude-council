import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  maskSecret,
  buildCouncilEntry,
  parseConfig,
  mergeCouncilEntry,
  writeConfigWithBackup,
  applyCouncilConfig,
  COUNCIL_TIMEOUT_MS,
  COUNCIL_SERVER_KEY,
} from "../src/setup/configWriter.js";

describe("maskSecret", () => {
  it("길이>4 입력은 마지막 4자만 남기고 앞부분을 *로 대체한다", () => {
    expect(maskSecret("abcdef")).toBe("**cdef");
    expect(maskSecret("1234567890")).toBe("******7890");
  });

  it("정확히 5자 입력은 앞 1자만 *로 대체한다", () => {
    expect(maskSecret("abcde")).toBe("*bcde");
  });

  it("길이<=4 입력은 전체를 *로 대체한다", () => {
    expect(maskSecret("abcd")).toBe("****");
    expect(maskSecret("ab")).toBe("**");
    expect(maskSecret("x")).toBe("*");
  });

  it("빈 문자열은 빈 문자열을 반환한다", () => {
    expect(maskSecret("")).toBe("");
  });

  it("마스킹 결과 길이는 원본 길이와 같다", () => {
    const secret = "super-secret-token-value";
    expect(maskSecret(secret).length).toBe(secret.length);
  });
});

describe("buildCouncilEntry", () => {
  it("command/args/timeout/env 를 규약대로 구성한다", () => {
    const entry = buildCouncilEntry({
      discordToken: "tok",
      discordChannelId: "chan",
      hostUserId: "host",
    });
    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["-y", "claude-council"]);
    expect(entry.timeout).toBe(COUNCIL_TIMEOUT_MS);
    expect(entry.timeout).toBeGreaterThanOrEqual(210_000);
    expect(entry.env).toEqual({
      DISCORD_TOKEN: "tok",
      DISCORD_CHANNEL_ID: "chan",
      HOST_USER_ID: "host",
    });
  });
});

describe("parseConfig", () => {
  it("빈 문자열에는 빈 mcpServers를 가진 기본 객체를 반환한다", () => {
    expect(parseConfig("")).toEqual({ mcpServers: {} });
    expect(parseConfig("   ")).toEqual({ mcpServers: {} });
  });

  it("깨진 JSON 문자열에는 예외를 던지고 자동 수정하지 않는다", () => {
    expect(() => parseConfig("{ broken json")).toThrowError(/파싱 실패/);
  });

  it("mcpServers가 없으면 빈 객체로 보강한다", () => {
    expect(parseConfig("{}")).toEqual({ mcpServers: {} });
  });

  it("기존 서버 항목을 보존한다", () => {
    const cfg = parseConfig('{"mcpServers":{"other":{"command":"x"}}}');
    expect(cfg.mcpServers.other).toEqual({ command: "x" });
  });
});

describe("mergeCouncilEntry", () => {
  it("다른 서버 항목을 보존하면서 council-vote 를 추가한다", () => {
    const base = { mcpServers: { other: { command: "x" } } };
    const entry = buildCouncilEntry({
      discordToken: "t",
      discordChannelId: "c",
      hostUserId: "h",
    });
    const merged = mergeCouncilEntry(base, entry);
    expect(merged.mcpServers.other).toEqual({ command: "x" });
    expect(merged.mcpServers[COUNCIL_SERVER_KEY]).toEqual(entry);
  });

  it("최상위의 다른 키도 보존한다", () => {
    const base = { mcpServers: {}, someOtherTopLevel: 1 } as const;
    const entry = buildCouncilEntry({ discordToken: "t", discordChannelId: "c", hostUserId: "h" });
    const merged = mergeCouncilEntry(base as any, entry);
    expect((merged as any).someOtherTopLevel).toBe(1);
  });

  it("기존 council-vote 엔트리는 다른 서버를 보존한 채 교체한다", () => {
    const base = {
      mcpServers: {
        other: { command: "x" },
        [COUNCIL_SERVER_KEY]: { command: "stale", args: ["old"], timeout: 1, env: {} },
      },
    };
    const entry = buildCouncilEntry({ discordToken: "new-t", discordChannelId: "new-c", hostUserId: "new-h" });
    const merged = mergeCouncilEntry(base as any, entry);
    expect(merged.mcpServers.other).toEqual({ command: "x" });
    expect(merged.mcpServers[COUNCIL_SERVER_KEY]).toEqual(entry);
    expect((merged.mcpServers[COUNCIL_SERVER_KEY] as any).command).toBe("npx");
  });

  it("여러 다른 서버 항목을 모두 보존한다", () => {
    const a = { command: "a" };
    const b = { command: "b" };
    const base = { mcpServers: { a, b } };
    const entry = buildCouncilEntry({ discordToken: "t", discordChannelId: "c", hostUserId: "h" });
    const merged = mergeCouncilEntry(base as any, entry);
    expect(merged.mcpServers.a).toEqual(a);
    expect(merged.mcpServers.b).toEqual(b);
    expect(Object.keys(merged.mcpServers).sort()).toEqual(["a", "b", COUNCIL_SERVER_KEY].sort());
  });

  it("입력 config 객체를 변형하지 않는다(불변)", () => {
    const base = { mcpServers: { other: { command: "x" } } };
    const entry = buildCouncilEntry({ discordToken: "t", discordChannelId: "c", hostUserId: "h" });
    mergeCouncilEntry(base, entry);
    expect(base.mcpServers).toEqual({ other: { command: "x" } });
    expect((base.mcpServers as any)[COUNCIL_SERVER_KEY]).toBeUndefined();
  });
});

describe("writeConfigWithBackup / applyCouncilConfig (fs)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "council-setup-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("디렉토리가 없으면 생성하고 파일을 쓴다", () => {
    const filePath = join(dir, "nested", "deep", "mcp.json");
    writeConfigWithBackup(filePath, { mcpServers: {} });
    expect(existsSync(filePath)).toBe(true);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ mcpServers: {} });
  });

  it("기존 파일은 .bak 으로 백업한 뒤 덮어쓴다", () => {
    const filePath = join(dir, "mcp.json");
    writeFileSync(filePath, '{"mcpServers":{"old":{}}}', "utf8");
    writeConfigWithBackup(filePath, { mcpServers: { new: {} } });
    expect(existsSync(`${filePath}.bak`)).toBe(true);
    expect(JSON.parse(readFileSync(`${filePath}.bak`, "utf8"))).toEqual({ mcpServers: { old: {} } });
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ mcpServers: { new: {} } });
  });

  it("applyCouncilConfig 는 기존 서버를 보존하며 council-vote 를 병합 저장한다", () => {
    const filePath = join(dir, "mcp.json");
    writeFileSync(filePath, '{"mcpServers":{"other":{"command":"x"}}}', "utf8");
    const merged = applyCouncilConfig(filePath, {
      discordToken: "discord-token-1234",
      discordChannelId: "999",
      hostUserId: "host-9",
    });
    const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
    expect(onDisk.mcpServers.other).toEqual({ command: "x" });
    expect(onDisk.mcpServers[COUNCIL_SERVER_KEY].command).toBe("npx");
    expect(onDisk.mcpServers[COUNCIL_SERVER_KEY].timeout).toBe(COUNCIL_TIMEOUT_MS);
    expect(merged.mcpServers[COUNCIL_SERVER_KEY]).toBeDefined();
  });

  it("applyCouncilConfig 는 깨진 JSON에 대해 예외를 던지고 쓰기를 하지 않는다(all-or-nothing)", () => {
    const filePath = join(dir, "mcp.json");
    writeFileSync(filePath, "{ broken", "utf8");
    expect(() =>
      applyCouncilConfig(filePath, { discordToken: "t", discordChannelId: "c", hostUserId: "h" }),
    ).toThrowError(/파싱 실패/);
    // 원본은 그대로, 백업도 생기지 않음
    expect(readFileSync(filePath, "utf8")).toBe("{ broken");
    expect(existsSync(`${filePath}.bak`)).toBe(false);
  });

  it("파일이 없을 때 applyCouncilConfig 는 새로 생성한다", () => {
    const filePath = join(dir, "fresh", "mcp.json");
    applyCouncilConfig(filePath, { discordToken: "t", discordChannelId: "c", hostUserId: "h" });
    const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
    expect(onDisk.mcpServers[COUNCIL_SERVER_KEY].args).toEqual(["-y", "claude-council"]);
  });
});

describe("writeConfigWithBackup 백업/단일쓰기 보장 (fs)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "council-write-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("설정을 1회 기록하며 임시/부분 파일을 남기지 않는다(all-or-nothing)", () => {
    const filePath = join(dir, "mcp.json");
    writeConfigWithBackup(filePath, { mcpServers: { only: {} } });
    // 새 파일 쓰기는 대상 파일 하나만 생성한다(temp 파일/2단계 쓰기 흔적 없음)
    expect(fs.readdirSync(dir)).toEqual(["mcp.json"]);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ mcpServers: { only: {} } });
  });

  it("기존 파일이 없으면 .bak 백업을 만들지 않는다", () => {
    const filePath = join(dir, "mcp.json");
    writeConfigWithBackup(filePath, { mcpServers: {} });
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(`${filePath}.bak`)).toBe(false);
  });

  it("기존 파일이 있으면 .bak 백업을 먼저 만든 뒤 디렉토리 없이도 1회 기록한다", () => {
    const filePath = join(dir, "missing", "mcp.json");
    // 디렉토리 없음 + 기존 파일 없음: 디렉토리 생성 검증
    writeConfigWithBackup(filePath, { mcpServers: { v: 1 } });
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(`${filePath}.bak`)).toBe(false);

    // 두 번째 쓰기: 기존 파일이 있으므로 .bak 백업이 원본 바이트를 그대로 보존
    const originalBytes = readFileSync(filePath, "utf8");
    writeConfigWithBackup(filePath, { mcpServers: { v: 2 } });
    expect(readFileSync(`${filePath}.bak`, "utf8")).toBe(originalBytes);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ mcpServers: { v: 2 } });
  });

  it("출력 JSON 은 2-스페이스 들여쓰기 + 끝에 개행을 가진다", () => {
    const filePath = join(dir, "mcp.json");
    writeConfigWithBackup(filePath, { mcpServers: {} });
    const onDisk = readFileSync(filePath, "utf8");
    expect(onDisk.endsWith("\n")).toBe(true);
    expect(onDisk).toBe(`${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
  });
});
