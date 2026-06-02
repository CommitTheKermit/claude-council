import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { loadConfig } from "./config.js";
import { DiscordAdapter } from "./discord/adapter.js";
import { DiscordVoteChannel } from "./discord/discordVoteChannel.js";
import { bootstrapSession } from "./council/session.js";

/**
 * 진입점: 호스트가 Claude Code 세션을 시작하고, AskUserQuestion을 Discord 투표로 라우팅한다.
 *
 * bootstrapSession 이 TS Agent SDK query()를 canUseTool 콜백과 함께 초기화한다.
 * canUseTool 은 AskUserQuestion만 협의(투표)로 라우팅하고 그 외 도구는 기본 allow 한다.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  // Discord 클라이언트 로그인 후 채널 포트를 어댑터에 주입한다.
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  await client.login(config.discordToken);

  client.once("ready", (c) => console.log(`[discord] 봇 로그인 완료: ${c.user.tag}`));
  console.log(`[discord] 채널 ${config.discordChannelId} 로 로그인 시도 중...`);

  // 호스트 폴백 결정 제한 시간은 투표 타임아웃과 동일하게 둔다.
  const channel = new DiscordVoteChannel(client, config.discordChannelId);
  const adapter = new DiscordAdapter(channel, config.rules.timeoutMs);

  const prompt = process.argv.slice(2).join(" ") || "협업 세션을 시작합니다.";
  console.log(`[claude] 세션 시작, 프롬프트: ${prompt}`);

  const { query } = await bootstrapSession({
    prompt,
    adapter,
    rules: config.rules,
  });

  // SDK query()는 메시지 스트림(AsyncGenerator)을 돌려준다.
  // 어떤 메시지가 오가는지(특히 AskUserQuestion 가로채기/인증 오류) 보이도록 로깅한다.
  for await (const message of query as AsyncIterable<Record<string, unknown>>) {
    logSdkMessage(message);
  }
  console.log("[claude] 세션 종료.");
}

// SDK 메시지 스트림을 사람이 읽을 수 있게 요약 출력한다.
function logSdkMessage(message: Record<string, unknown>): void {
  const type = message.type;
  if (type === "system") {
    console.log(`[claude] system: ${String(message.subtype ?? "")}`);
  } else if (type === "assistant" || type === "user") {
    // content 블록에서 텍스트/도구 호출만 간략히 보여준다.
    const content = (message.message as { content?: unknown[] } | undefined)?.content ?? [];
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "text") {
        console.log(`[claude] ${type}: ${String(block.text).slice(0, 200)}`);
      } else if (block.type === "tool_use") {
        console.log(`[claude] tool_use: ${String(block.name)}`);
      }
    }
  } else if (type === "result") {
    console.log(`[claude] result(${String(message.subtype ?? "")}): ${String(message.result ?? "")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
