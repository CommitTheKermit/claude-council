import type { Vote, VoteRules, TallyResult, TallyOutcome } from "./types.js";

export interface TallyInput {
  votes: Vote[];
  // 정족수 계산 기준이 되는 전체 참여자 수 (채널 멤버 수)
  participantCount: number;
  rules: VoteRules;
  // 타임아웃으로 마감됐는지
  timedOut?: boolean;
  // 호스트 폴백이 필요할 때 호스트가 내린 결정 (label)
  hostChoice?: string;
}

// 한 사람당 한 표(마지막 표 우선)로 정규화한 뒤 label별 득표 수를 센다
function countByChoice(votes: Vote[]): Map<string, number> {
  const lastVoteByUser = new Map<string, string>();
  for (const v of votes) {
    lastVoteByUser.set(v.userId, v.choice);
  }
  const counts = new Map<string, number>();
  for (const choice of lastVoteByUser.values()) {
    counts.set(choice, (counts.get(choice) ?? 0) + 1);
  }
  return counts;
}

function uniqueVoterCount(votes: Vote[]): number {
  return new Set(votes.map((v) => v.userId)).size;
}

// 정족수 충족 여부: 투표한 사람 비율이 기준 이상인가
function isQuorumMet(voterCount: number, participantCount: number, quorumRatio: number): boolean {
  return participantCount > 0 && voterCount / participantCount >= quorumRatio;
}

// classifyOutcome 입력 (hostChoice 불필요 - 결과 유형만 판정)
export type ClassifyInput = Omit<TallyInput, "hostChoice">;

/**
 * hostChoice 없이 집계 결과 "유형"만 판정한다.
 * - 타임아웃 + 무응답         -> host-timeout
 * - 정족수 미달               -> host-quorum-fail
 * - 정족수 충족 + 동점        -> host-tiebreak
 * - 정족수 충족 + 단독 최다득 -> majority
 *
 * 폴백 사유(reason) 산출과 tallyVotes 판정에 공통으로 쓰인다.
 */
export function classifyOutcome(input: ClassifyInput): TallyOutcome {
  const { votes, participantCount, rules, timedOut } = input;
  const voterCount = uniqueVoterCount(votes);

  // 타임아웃 + 아무도 투표 안 함
  if (timedOut && voterCount === 0) {
    return "host-timeout";
  }

  // 정족수 미달
  if (!isQuorumMet(voterCount, participantCount, rules.quorumRatio)) {
    return "host-quorum-fail";
  }

  const counts = countByChoice(votes);
  const max = Math.max(...counts.values());
  const winners = [...counts.entries()].filter(([, c]) => c === max);

  // 동점
  if (winners.length > 1) {
    return "host-tiebreak";
  }

  return "majority";
}

// host-* 결과는 호스트 폴백이 필요하다.
export function requiresHostFallback(outcome: TallyOutcome): boolean {
  return outcome !== "majority";
}

/**
 * 투표를 집계해 Claude에 주입할 최종 선택을 결정한다.
 *
 * 규칙:
 * - 타임아웃 + 무응답         -> 호스트 결정 (host-timeout)
 * - 정족수 미달               -> 호스트 결정 (host-quorum-fail)
 * - 정족수 충족 + 동점        -> 호스트 결정 (host-tiebreak)
 * - 정족수 충족 + 단독 최다득 -> 그 선택 (majority)
 *
 * 호스트 결정이 필요한 경우 hostChoice가 반드시 제공되어야 한다.
 */
export function tallyVotes(input: TallyInput): TallyResult {
  const outcome = classifyOutcome(input);

  if (requiresHostFallback(outcome)) {
    if (input.hostChoice === undefined) {
      throw new Error(`호스트 결정이 필요한 상황(${outcome})이지만 hostChoice가 없습니다.`);
    }
    return { choice: input.hostChoice, outcome, contested: true };
  }

  // majority: 단독 최다 득표 label
  const counts = countByChoice(input.votes);
  const max = Math.max(...counts.values());
  const winner = [...counts.entries()].find(([, c]) => c === max)![0];
  return { choice: winner, outcome: "majority", contested: false };
}

// 기본 투표 규칙
export const DEFAULT_RULES: Omit<VoteRules, "hostUserId"> = {
  timeoutMs: 180_000, // 3분
  quorumRatio: 0.5, // 과반
};
