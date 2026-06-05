import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

describe("plugin manifest (.claude-plugin/plugin.json)", () => {
  const manifestPath = path.join(repoRoot, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  it("유효 JSON 이고 name 이 claude-council 이다", () => {
    expect(manifest.name).toBe("claude-council");
  });

  it("version 이 0.1.1 이다", () => {
    expect(manifest.version).toBe("0.1.1");
  });

  it("description 이 비어있지 않다", () => {
    expect(typeof manifest.description).toBe("string");
    expect(manifest.description.length).toBeGreaterThan(0);
  });

  it("skills 가 ./skills/ 를 가리킨다", () => {
    expect(manifest.skills).toBe("./skills/");
  });

  it("mcpServers 가 ./.claude-plugin/.mcp.json 을 가리킨다", () => {
    expect(manifest.mcpServers).toBe("./.claude-plugin/.mcp.json");
  });
});

describe("marketplace manifest (.claude-plugin/marketplace.json)", () => {
  const marketplacePath = path.join(repoRoot, ".claude-plugin", "marketplace.json");
  const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));

  it("name/owner 와 plugins[].source 를 갖는다", () => {
    expect(typeof marketplace.name).toBe("string");
    expect(marketplace.name.length).toBeGreaterThan(0);
    expect(marketplace.owner).toBeDefined();
    expect(Array.isArray(marketplace.plugins)).toBe(true);
    expect(marketplace.plugins[0].source).toBeDefined();
  });
});

describe("bundled mcp config (.claude-plugin/.mcp.json)", () => {
  const repoMcpPath = path.join(repoRoot, ".mcp.json");
  const bundledPath = path.join(repoRoot, ".claude-plugin", ".mcp.json");
  const bundled = JSON.parse(readFileSync(bundledPath, "utf8"));

  it("repo 루트 .mcp.json 은 삭제되어 dev 자동로드를 회피한다", () => {
    expect(existsSync(repoMcpPath)).toBe(false);
  });

  it("council-vote env 는 ${VAR} 참조만 담는다(리터럴 금지)", () => {
    expect(bundled.mcpServers["council-vote"].env).toEqual({
      DISCORD_TOKEN: "${DISCORD_TOKEN}",
      DISCORD_CHANNEL_ID: "${DISCORD_CHANNEL_ID}",
      HOST_USER_ID: "${HOST_USER_ID}",
    });
  });
});

describe("package.json bin (council-setup)", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

  it("bin['council-setup'] 가 dist/setup/applyFromEnv.js 를 가리킨다", () => {
    expect(pkg.bin["council-setup"]).toBe("dist/setup/applyFromEnv.js");
  });

  it("version 이 0.1.1 이고 files 가 ['dist','skills'] 다", () => {
    expect(pkg.version).toBe("0.1.1");
    expect(pkg.files).toEqual(["dist", "skills"]);
  });
});

describe("setup runner shebang (src/setup/applyFromEnv.ts)", () => {
  it("첫 줄이 #!/usr/bin/env node 다", () => {
    const src = readFileSync(path.join(repoRoot, "src", "setup", "applyFromEnv.ts"), "utf8");
    expect(src.split("\n")[0]).toBe("#!/usr/bin/env node");
  });
});
