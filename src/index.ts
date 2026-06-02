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

  // 호스트 폴백 결정 제한 시간은 투표 타임아웃과 동일하게 둔다.
  const channel = new DiscordVoteChannel(client, config.discordChannelId);
  const adapter = new DiscordAdapter(channel, config.rules.timeoutMs);

  const prompt = process.argv.slice(2).join(" ") || "협업 세션을 시작합니다.";

  const { query } = await bootstrapSession({
    prompt,
    adapter,
    rules: config.rules,
  });

  // SDK query()는 메시지 스트림(AsyncGenerator)을 돌려준다. 끝까지 소비한다.
  for await (const _message of query as AsyncIterable<unknown>) {
    void _message;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
