import type { VoteRules } from "./council/types.js";
import { DEFAULT_RULES } from "./council/tally.js";

export interface AppConfig {
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

  // Claude 인증은 Agent SDK가 환경변수에서 직접 읽는다.
  // ANTHROPIC_API_KEY 가 설정돼 있으면 종량 과금 경로를 타므로 여기서 요구하지 않는다.
  // Max 구독으로 추가 과금 없이 쓰려면 ANTHROPIC_API_KEY 를 설정하지 말고
  // 로컬 `claude` 로그인(OAuth) 세션 또는 CLAUDE_CODE_OAUTH_TOKEN 을 사용한다.
  return {
    discordToken: required("DISCORD_TOKEN"),
    discordChannelId: required("DISCORD_CHANNEL_ID"),
    rules: {
      timeoutMs: timeoutSeconds ? Number(timeoutSeconds) * 1000 : DEFAULT_RULES.timeoutMs,
      quorumRatio: quorumRatio ? Number(quorumRatio) : DEFAULT_RULES.quorumRatio,
      hostUserId: required("HOST_USER_ID"),
    },
  };
}
