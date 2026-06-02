import type { CouncilQuestion, VoteRules, TallyResult, TallyOutcome } from "./types.js";
import { tallyVotes, classifyOutcome, requiresHostFallback } from "./tally.js";
import { parseAskUserQuestionInput } from "./parseQuestion.js";
import type { MessagingAdapter } from "../discord/adapter.js";

// 호스트 폴백 시 호스트에게 전달할 사람이 읽을 수 있는 사유 문구.
// 폴백 트리거(정족수 미달/동점/타임아웃)를 정확히 구분해 전달한다.
export function fallbackReason(outcome: TallyOutcome): string {
  switch (outcome) {
    case "host-quorum-fail":
      return "정족수 미달: 제한 시간 내 투표 인원이 정족수에 도달하지 못했습니다.";
    case "host-tiebreak":
      return "동점: 최다 득표 선택지가 둘 이상이라 결정할 수 없습니다.";
    case "host-timeout":
      return "타임아웃: 제한 시간 내 아무도 투표하지 않았습니다.";
    default:
      return "호스트 결정이 필요합니다.";
  }
}

// 한 질문에 대해: 채널 투표 -> 집계 -> (필요 시) 호스트 폴백 까지 수행해 최종 결정을 낸다.
export async function resolveCouncilDecision(
  question: CouncilQuestion,
  adapter: MessagingAdapter,
  rules: VoteRules,
): Promise<TallyResult> {
  const poll = await adapter.poll(question, rules);
  const tallyInput = {
    votes: poll.votes,
    participantCount: poll.participantCount,
    rules,
    timedOut: poll.timedOut,
  };

  // 집계 결과 유형을 먼저 판정한다 (정족수 미달/동점/타임아웃 -> 호스트 폴백).
  const outcome = classifyOutcome(tallyInput);
  if (!requiresHostFallback(outcome)) {
    return tallyVotes(tallyInput);
  }

  // 폴백 경로: 정확한 사유와 함께 호스트에게 결정을 요청한 뒤 재집계한다.
  const hostChoice = await adapter.askHost(question, rules.hostUserId, fallbackReason(outcome));
  return tallyVotes({ ...tallyInput, hostChoice });
}

// canUseTool이 반환해야 하는 허용 결과의 최소 형태
interface PermissionAllow {
  behavior: "allow";
  updatedInput: Record<string, unknown> & { answers: Record<string, string> };
}

/**
 * Agent SDK의 canUseTool 콜백에서 AskUserQuestion을 가로채 처리하는 핸들러.
 * 원시 입력 payload를 parseAskUserQuestionInput으로 검증/추출한 뒤
 * 질문별로 투표 합의를 모아 answers로 주입한다.
 */
export async function handleAskUserQuestion(
  input: unknown,
  adapter: MessagingAdapter,
  rules: VoteRules,
): Promise<PermissionAllow> {
  const questions = parseAskUserQuestionInput(input);
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const result = await resolveCouncilDecision(question, adapter, rules);
    answers[question.question] = result.choice;
  }
  // 원시 입력을 보존한 채 answers만 추가해 Claude에 주입한다.
  const original = input as Record<string, unknown>;
  return {
    behavior: "allow",
    updatedInput: { ...original, answers },
  };
}
