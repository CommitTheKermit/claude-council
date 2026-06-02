import type { VoteRules } from "./council/types.js";
import { DEFAULT_RULES } from "./council/tally.js";

export interface AppConfig {
  anthropicApiKey: string;
  discordToken: string;
  discordChannelId: string;
  rules: VoteRules;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 가 설정되지 않았습니다.`);
  return v;
}

// .env / process.env 에서 설정을 로드한다. 투표 규칙은 미설정 시 기본값 사용.
export function loadConfig(): AppConfig {
  const timeoutSeconds = process.env.VOTE_TIMEOUT_SECONDS;
  const quorumRatio = process.env.VOTE_QUORUM_RATIO;

  return {
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    discordToken: required("DISCORD_TOKEN"),
    discordChannelId: required("DISCORD_CHANNEL_ID"),
    rules: {
      timeoutMs: timeoutSeconds ? Number(timeoutSeconds) * 1000 : DEFAULT_RULES.timeoutMs,
      quorumRatio: quorumRatio ? Number(quorumRatio) : DEFAULT_RULES.quorumRatio,
      hostUserId: required("HOST_USER_ID"),
    },
  };
}
