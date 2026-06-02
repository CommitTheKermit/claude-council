import "dotenv/config";
import { loadConfig } from "./config.js";
import { DiscordAdapter } from "./discord/adapter.js";
import { handleAskUserQuestion } from "./council/canUseTool.js";

/**
 * 진입점: 호스트가 Claude Code 세션을 시작하고, AskUserQuestion을 Discord 투표로 라우팅한다.
 *
 * TODO (다음 슬라이스):
 *  - @anthropic-ai/claude-agent-sdk 의 query()/canUseTool 콜백에 handleAskUserQuestion 연결
 *  - canUseTool 콜백에서 toolName === "AskUserQuestion" 일 때만 위 핸들러로 위임,
 *    그 외 도구는 기본 allow
 *  - DiscordAdapter 에 discord.js Client 주입 및 로그인
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const adapter = new DiscordAdapter(config.discordChannelId);

  // 예시 배선 (SDK 연결 전 골격):
  // const result = await query({
  //   prompt: "...",
  //   options: {
  //     canUseTool: async (toolName, input) => {
  //       if (toolName === "AskUserQuestion") {
  //         return handleAskUserQuestion(input, adapter, config.rules);
  //       }
  //       return { behavior: "allow", updatedInput: input };
  //     },
  //   },
  // });

  void adapter;
  void handleAskUserQuestion;
  console.log("claude-council 골격 로드됨. SDK 배선은 다음 슬라이스에서 구현합니다.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
