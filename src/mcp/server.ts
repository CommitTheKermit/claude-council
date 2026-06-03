#!/usr/bin/env node
import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config.js";
import { bootstrapMcpServer, type McpServerLike } from "./bootstrap.js";

/**
 * council_vote MCP stdio 서버 진입점 (thin shell).
 *
 * 실제 구현(loadConfig / discord.js Client / McpServer / StdioServerTransport /
 * process.exit / console.error)만 bootstrapMcpServer 에 주입한다.
 * stdout 은 JSON-RPC 전용이므로 모든 로그는 stderr(console.error) 로만 보낸다.
 */
bootstrapMcpServer({
  loadConfig,
  createClient: () =>
    new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    }),
  login: (client, token) => (client as Client).login(token),
  createServer: () =>
    new McpServer({
      name: "claude-council",
      version: "0.1.0",
    }) as unknown as McpServerLike,
  createTransport: () => new StdioServerTransport(),
  exit: (code) => process.exit(code),
  // stdout 오염 금지: 진단 로그는 stderr 로만 출력.
  logError: (...args) => console.error(...args),
}).catch((err) => {
  console.error("[council-mcp] 부팅 중 처리되지 않은 오류:", err);
  process.exit(1);
});
