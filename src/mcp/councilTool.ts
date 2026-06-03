import { z } from "zod";
import type { MessagingAdapter, PollResult } from "../discord/adapter.js";
import type {
  CouncilQuestion,
  VoteRules,
  TallyResult,
  TallyOutcome,
} from "../council/types.js";
import { resolveCouncilDecision } from "../council/canUseTool.js";

// council_vote MCP 도구 이름.
export const COUNCIL_VOTE_TOOL_NAME = "council_vote";

/**
 * council_vote 의 inputSchema (zod raw shape).
 * server.registerTool(name, { inputSchema }, cb) 에 그대로 넘기며,
 * Claude가 던지는 객관식 질문(question/header/options)을 표현한다.
 */
export const councilVoteInputShape = {
  question: z.string(),
  header: z.string().optional(),
  options: z
    .array(z.object({ label: z.string(), description: z.string().optional() }))
    .min(2),
};

// registerTool 콜백이 받는 검증된 입력 형태 (councilVoteInputShape 와 일치).
export interface CouncilVoteInput {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
}

// MCP 도구가 돌려주는 콘텐츠 형태 (CallToolResult 의 최소 표면).
export interface CouncilToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

// TallyOutcome(코어) -> 응답 outcome 분류(majority|tie|no-quorum|timeout) 매핑.
function mapOutcome(outcome: TallyOutcome): string {
  switch (outcome) {
    case "majority":
      return "majority";
    case "host-tiebreak":
      return "tie";
    case "host-quorum-fail":
      return "no-quorum";
    case "host-timeout":
      return "timeout";
    default:
      return "host-fallback";
  }
}

// 정족수 충족 여부: 단독 최다(majority)/동점(host-tiebreak)은 정족수를 채운 상태.
function quorumWasMet(outcome: TallyOutcome): boolean {
  return outcome === "majority" || outcome === "host-tiebreak";
}

/**
 * 어댑터를 감싸 resolveCouncilDecision 이 호출한 poll() 결과를 가로채 보관한다.
 * (코어 adapter / resolveCouncilDecision 소스는 변경하지 않고, 데코레이터로
 * 투표 수/정족수 기준 인원 같은 응답 표시용 수치를 노출하기 위함.)
 */
function instrumentAdapter(adapter: MessagingAdapter): {
  wrapped: MessagingAdapter;
  lastPoll: () => PollResult | undefined;
} {
  let last: PollResult | undefined;
  const wrapped: MessagingAdapter = {
    poll: async (question, rules) => {
      const result = await adapter.poll(question, rules);
      last = result;
      return result;
    },
    askHost: (question, hostUserId, reason) =>
      adapter.askHost(question, hostUserId, reason),
  };
  return { wrapped, lastPoll: () => last };
}

// 성공 응답 4줄 템플릿 (Result / Outcome / Votes / Fallback) 을 개행으로 연결.
function formatResult(result: TallyResult, poll: PollResult | undefined): string {
  const totalVotes = poll ? new Set(poll.votes.map((v) => v.userId)).size : 0;
  const quorumTotal = poll ? poll.participantCount : 0;
  const quorumMet = quorumWasMet(result.outcome);
  const fallback = result.contested ? "host" : "none";
  return [
    `Result: ${result.choice}`,
    `Outcome: ${mapOutcome(result.outcome)}`,
    `Votes: ${totalVotes}/${quorumTotal} (quorum ${quorumMet ? "met" : "not met"})`,
    `Fallback: ${fallback}`,
  ].join("\n");
}

/**
 * council_vote 도구 핸들러 팩토리 (Dependency Injection).
 * adapter 와 rules 를 주입받아, 검증된 입력을 받아 투표 합의를 수행하는
 * MCP 도구 콜백을 돌려준다. 코어 오케스트레이션은 resolveCouncilDecision 에 위임한다.
 *
 * 시작 로그인 성공 이후의 런타임 오류는 throw 하지 않고 isError=true 콘텐츠로 반환해
 * 프로세스를 종료시키지 않는다.
 */
export function createCouncilVoteHandler(
  adapter: MessagingAdapter,
  rules: VoteRules,
): (input: CouncilVoteInput) => Promise<CouncilToolResult> {
  return async (input: CouncilVoteInput): Promise<CouncilToolResult> => {
    try {
      const question: CouncilQuestion = {
        question: input.question,
        header: input.header ?? "",
        options: input.options,
      };

      const { wrapped, lastPoll } = instrumentAdapter(adapter);
      const result = await resolveCouncilDecision(question, wrapped, rules);
      const text = formatResult(result, lastPoll());
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `council_vote 오류: ${message}` }],
        isError: true,
      };
    }
  };
}
