import type { CouncilQuestion, VoteRules, TallyResult } from "./types.js";
import { tallyVotes } from "./tally.js";
import type { MessagingAdapter } from "../discord/adapter.js";

// 한 질문에 대해: 채널 투표 -> 집계 -> (필요 시) 호스트 폴백 까지 수행해 최종 결정을 낸다.
export async function resolveCouncilDecision(
  question: CouncilQuestion,
  adapter: MessagingAdapter,
  rules: VoteRules,
): Promise<TallyResult> {
  const poll = await adapter.poll(question, rules.timeoutMs);

  // 1차 집계 시도 (호스트 결정이 필요하면 throw)
  try {
    return tallyVotes({
      votes: poll.votes,
      participantCount: poll.participantCount,
      rules,
      timedOut: poll.timedOut,
    });
  } catch {
    // 정족수 미달 / 동점 / 타임아웃 무응답 -> 호스트에게 결정 요청 후 재집계
    const reason = poll.timedOut ? "타임아웃 또는 정족수 미달" : "동점 또는 정족수 미달";
    const hostChoice = await adapter.askHost(question, rules.hostUserId, reason);
    return tallyVotes({
      votes: poll.votes,
      participantCount: poll.participantCount,
      rules,
      timedOut: poll.timedOut,
      hostChoice,
    });
  }
}

// Agent SDK canUseTool 콜백이 넘겨주는 AskUserQuestion 입력의 최소 형태
interface AskUserQuestionInput {
  questions: CouncilQuestion[];
}

// canUseTool이 반환해야 하는 허용 결과의 최소 형태
interface PermissionAllow {
  behavior: "allow";
  updatedInput: AskUserQuestionInput & { answers: Record<string, string> };
}

/**
 * Agent SDK의 canUseTool 콜백에서 AskUserQuestion을 가로채 처리하는 핸들러.
 * TODO: 실제 SDK 콜백 시그니처(PermissionResult 타입)에 맞춰 index.ts에서 어댑팅.
 */
export async function handleAskUserQuestion(
  input: AskUserQuestionInput,
  adapter: MessagingAdapter,
  rules: VoteRules,
): Promise<PermissionAllow> {
  const answers: Record<string, string> = {};
  for (const question of input.questions) {
    const result = await resolveCouncilDecision(question, adapter, rules);
    answers[question.question] = result.choice;
  }
  return {
    behavior: "allow",
    updatedInput: { ...input, answers },
  };
}
