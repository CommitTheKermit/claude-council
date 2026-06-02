import "dotenv/config";
import { loadConfig } from "./config.js";
import { DiscordAdapter } from "./discord/adapter.js";
import { bootstrapSession } from "./council/session.js";

/**
 * 진입점: 호스트가 Claude Code 세션을 시작하고, AskUserQuestion을 Discord 투표로 라우팅한다.
 *
 * bootstrapSession 이 TS Agent SDK query()를 canUseTool 콜백과 함께 초기화한다.
 * canUseTool 은 AskUserQuestion만 협의(투표)로 라우팅하고 그 외 도구는 기본 allow 한다.
 *
 * TODO (다음 슬라이스):
 *  - DiscordAdapter 에 discord.js Client 주입 및 로그인 (poll/askHost 실제 구현)
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const adapter = new DiscordAdapter(config.discordChannelId);

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
