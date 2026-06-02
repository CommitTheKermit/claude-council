import { describe, it, expect, vi } from "vitest";
import type { MessagingAdapter, PollResult } from "../src/discord/adapter.js";
import { classifyOutcome } from "../src/council/tally.js";
import { resolveCouncilDecision, fallbackReason } from "../src/council/canUseTool.js";
import { createCanUseTool, INTERCEPTED_TOOL_NAME } from "../src/council/session.js";
import type { CouncilQuestion, VoteRules } from "../src/council/types.js";

/**
 * AC: "When votes are tied at timeout, host receives fallback decision prompt"
 *
 * 시나리오: 제한 시간이 끝났을 때(timedOut) 투표가 들어왔으나 정족수는 충족하고
 * 최다 득표 선택지가 동점인 경우 -> 호스트가 폴백 결정 프롬프트(askHost)를 받고
 * 호스트의 결정이 그대로 Claude 에 주입되어야 한다.
 *
 * Discord API 는 mock MessagingAdapter 로 대체한다.
 */

const rules: VoteRules = {
  timeoutMs: 180_000, // 기본 3분
  quorumRatio: 0.5, // 과반
  hostUserId: "host-1",
};

const question: CouncilQuestion = {
  question: "배포 전략은?",
  header: "배포",
  options: [{ label: "롤링" }, { label: "블루그린" }, { label: "카나리" }],
};

// timedOut 상태에서 동점 표를 돌려주는 mock 어댑터.
// askHost 호출 인자를 검증할 수 있도록 spy 로 노출한다.
function tieAtTimeoutAdapter(opts: {
  poll: PollResult;
  hostChoice: string;
}) {
  const askHost = vi.fn(async () => opts.hostChoice);
  const poll = vi.fn(async () => opts.poll);
  const adapter: MessagingAdapter = { poll, askHost };
  return { adapter, askHost, poll };
}

describe("동점 + 타임아웃 -> 호스트 폴백", () => {
  it("타임아웃 시점 동점은 host-tiebreak 로 분류된다", () => {
    // 2명 투표(정족수 충족), 롤링 1표 / 블루그린 1표 동점, 타임아웃으로 마감
    const outcome = classifyOutcome({
      votes: [
        { userId: "u1", choice: "롤링" },
        { userId: "u2", choice: "블루그린" },
      ],
      participantCount: 2,
      rules,
      timedOut: true,
    });
    expect(outcome).toBe("host-tiebreak");
  });

  it("동점 폴백 사유 문구는 '동점' 임을 명확히 알린다", () => {
    const reason = fallbackReason("host-tiebreak");
    expect(reason).toContain("동점");
    // 정족수 미달/타임아웃 사유와 혼동되지 않아야 한다
    expect(reason).not.toBe(fallbackReason("host-quorum-fail"));
    expect(reason).not.toBe(fallbackReason("host-timeout"));
  });

  it("동점 폴백 시 호스트에게 동점 사유 프롬프트를 보내고 호스트 결정을 채택한다", async () => {
    const { adapter, askHost, poll } = tieAtTimeoutAdapter({
      poll: {
        votes: [
          { userId: "u1", choice: "롤링" },
          { userId: "u2", choice: "블루그린" },
        ],
        timedOut: true,
        participantCount: 2,
      },
      hostChoice: "카나리", // 호스트가 동점을 깨고 제3의 선택지로 결정
    });

    const result = await resolveCouncilDecision(question, adapter, rules);

    // 호스트가 폴백 결정 프롬프트를 받았다
    expect(askHost).toHaveBeenCalledTimes(1);
    const [askedQuestion, askedHostId, askedReason] = askHost.mock.calls[0];
    expect(askedQuestion).toEqual(question);
    expect(askedHostId).toBe("host-1");
    expect(askedReason).toContain("동점");

    // 호스트 결정이 최종 답으로 채택되고, 동점 폴백으로 표시된다
    expect(result).toEqual({ choice: "카나리", outcome: "host-tiebreak", contested: true });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("canUseTool 경로: 동점+타임아웃이면 호스트 결정 label 이 answers 로 주입된다", async () => {
    const { adapter, askHost } = tieAtTimeoutAdapter({
      poll: {
        votes: [
          { userId: "u1", choice: "롤링" },
          { userId: "u2", choice: "블루그린" },
        ],
        timedOut: true,
        participantCount: 2,
      },
      hostChoice: "블루그린",
    });
    const cb = createCanUseTool(adapter, rules);

    const res = await cb(INTERCEPTED_TOOL_NAME, { questions: [question] });

    expect(askHost).toHaveBeenCalledTimes(1);
    expect(res.behavior).toBe("allow");
    if (res.behavior === "allow") {
      expect(res.updatedInput.questions).toEqual([question]);
      expect(res.updatedInput.answers).toEqual({ "배포 전략은?": "블루그린" });
    }
  });

  it("동점이라도 타임아웃이 아니면(조기 마감) 동일하게 호스트 폴백한다", async () => {
    // timedOut=false 라도 정족수 충족 + 동점이면 host-tiebreak 경로를 타야 한다
    const { adapter, askHost } = tieAtTimeoutAdapter({
      poll: {
        votes: [
          { userId: "u1", choice: "롤링" },
          { userId: "u2", choice: "블루그린" },
        ],
        timedOut: false,
        participantCount: 2,
      },
      hostChoice: "롤링",
    });

    const result = await resolveCouncilDecision(question, adapter, rules);

    expect(askHost).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("host-tiebreak");
    expect(result.choice).toBe("롤링");
  });
});
