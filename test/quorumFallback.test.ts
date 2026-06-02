import { describe, it, expect, vi } from "vitest";
import { resolveCouncilDecision, fallbackReason } from "../src/council/canUseTool.js";
import { createCanUseTool, INTERCEPTED_TOOL_NAME } from "../src/council/session.js";
import { classifyOutcome } from "../src/council/tally.js";
import { DiscordAdapter } from "../src/discord/adapter.js";
import type { VoteChannel, CollectResult, RawButtonVote } from "../src/discord/adapter.js";
import { CUSTOM_ID_PREFIX } from "../src/discord/voteMessage.js";
import type { MessagingAdapter } from "../src/discord/adapter.js";
import type { CouncilQuestion, VoteRules } from "../src/council/types.js";

/**
 * AC: "When quorum is not met within timeout, host receives fallback decision prompt"
 *
 * 시나리오: 제한 시간이 끝났는데 투표 인원이 정족수(quorumRatio)에 못 미친 경우.
 * 이때 봇은 호스트에게 폴백 결정 프롬프트를 보내고(askHost),
 * 호스트가 고른 답이 host-quorum-fail 결과로 Claude 에 주입돼야 한다.
 */

const rules: VoteRules = {
  timeoutMs: 1_000,
  quorumRatio: 0.5, // 과반
  hostUserId: "host-1",
};

const question: CouncilQuestion = {
  question: "배포 전략은?",
  header: "배포",
  options: [{ label: "롤링" }, { label: "블루그린" }, { label: "카나리" }],
};

// 버튼 클릭과 멤버 목록을 제어하는 mock VoteChannel (timedOut 제어 가능)
function mockChannel(
  memberIds: string[],
  interactions: RawButtonVote[],
  timedOut: boolean,
): VoteChannel {
  return {
    memberIds: async () => memberIds,
    postAndCollect: async (): Promise<CollectResult> => ({ interactions, timedOut }),
  };
}

describe("fallbackReason", () => {
  it("정족수 미달 사유에는 '정족수'가 포함된다", () => {
    expect(fallbackReason("host-quorum-fail")).toContain("정족수");
  });

  it("폴백 유형별로 서로 다른 사유 문구를 돌려준다", () => {
    const quorum = fallbackReason("host-quorum-fail");
    const tie = fallbackReason("host-tiebreak");
    const timeout = fallbackReason("host-timeout");
    expect(new Set([quorum, tie, timeout]).size).toBe(3);
  });
});

describe("classifyOutcome: 타임아웃 + 정족수 미달", () => {
  it("일부만 투표하고 타임아웃되면 host-quorum-fail 로 분류한다", () => {
    // 4명 중 1명만 투표(1/4 < 0.5), 타임아웃
    const outcome = classifyOutcome({
      votes: [{ userId: "u1", choice: "롤링" }],
      participantCount: 4,
      rules,
      timedOut: true,
    });
    expect(outcome).toBe("host-quorum-fail");
  });
});

describe("resolveCouncilDecision: 정족수 미달 -> 호스트 폴백 프롬프트", () => {
  it("타임아웃 후 정족수 미달이면 askHost 가 정족수 사유로 호출되고 호스트 답이 주입된다", async () => {
    // 4명 중 1명만 투표 -> 정족수 미달, 타임아웃
    const poll = {
      votes: [{ userId: "u1", choice: "롤링" }],
      participantCount: 4,
      timedOut: true,
    };
    const askHost = vi.fn(async () => "카나리");
    const adapter: MessagingAdapter = {
      poll: async () => poll,
      askHost,
    };

    const result = await resolveCouncilDecision(question, adapter, rules);

    // 호스트 폴백 프롬프트가 정확한 대상/사유로 발송됐는지
    expect(askHost).toHaveBeenCalledTimes(1);
    const [askedQuestion, hostUserId, reason] = askHost.mock.calls[0];
    expect(askedQuestion).toEqual(question);
    expect(hostUserId).toBe("host-1");
    expect(reason).toContain("정족수");

    // 호스트가 고른 답이 host-quorum-fail 로 확정된다
    expect(result).toEqual({
      choice: "카나리",
      outcome: "host-quorum-fail",
      contested: true,
    });
  });

  it("DiscordAdapter 끝-에서-끝: 멤버 다수 미투표로 정족수 미달 시 호스트 답이 주입된다", async () => {
    // 멤버 4명, 단 1명만 버튼 클릭 -> 1/4 정족수 미달, 타임아웃 마감
    const channel = mockChannel(
      ["u1", "u2", "u3", "u4"],
      [{ userId: "u1", customId: `${CUSTOM_ID_PREFIX}:0` }],
      true,
    );
    const askHost = vi.fn(async () => "블루그린");
    const adapter = new DiscordAdapter(channel);
    // DiscordAdapter.askHost 는 다음 슬라이스 미구현이므로 폴백 경로를 스파이로 대체
    adapter.askHost = askHost;
    const cb = createCanUseTool(adapter, rules);

    const res = await cb(INTERCEPTED_TOOL_NAME, { questions: [question] });

    expect(askHost).toHaveBeenCalledTimes(1);
    expect(askHost.mock.calls[0][2]).toContain("정족수");
    expect(res.behavior).toBe("allow");
    if (res.behavior === "allow") {
      // 호스트가 결정한 답이 질문 텍스트 키로 주입된다
      expect(res.updatedInput.answers).toEqual({ "배포 전략은?": "블루그린" });
    }
  });

  it("정족수를 충족하면 호스트 폴백 없이 과반 답을 그대로 쓴다 (음성 검증)", async () => {
    // 4명 중 3명 투표(3/4 >= 0.5), 롤링 2표 -> majority
    const poll = {
      votes: [
        { userId: "u1", choice: "롤링" },
        { userId: "u2", choice: "롤링" },
        { userId: "u3", choice: "블루그린" },
      ],
      participantCount: 4,
      timedOut: true,
    };
    const askHost = vi.fn(async () => "카나리");
    const adapter: MessagingAdapter = { poll: async () => poll, askHost };

    const result = await resolveCouncilDecision(question, adapter, rules);

    expect(askHost).not.toHaveBeenCalled();
    expect(result).toEqual({ choice: "롤링", outcome: "majority", contested: false });
  });
});
