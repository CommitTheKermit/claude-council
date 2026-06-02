import { describe, it, expect, vi } from "vitest";
import { DiscordAdapter } from "../src/discord/adapter.js";
import type { VoteChannel, CollectResult } from "../src/discord/adapter.js";
import { createCanUseTool, INTERCEPTED_TOOL_NAME } from "../src/council/session.js";
import {
  resolveCouncilDecision,
  fallbackReason,
} from "../src/council/canUseTool.js";
import { classifyOutcome, DEFAULT_RULES } from "../src/council/tally.js";
import type { CouncilQuestion, VoteRules } from "../src/council/types.js";

/**
 * AC: "When no one votes within 3 minutes, host receives fallback decision
 *      prompt and can answer directly"
 *
 * 이 슬라이스는 "타임아웃 무응답" 폴백 경로(host-timeout)를 끝-에서-끝으로 검증한다:
 *   채널 게시 -> 제한 시간(기본 3분) 내 아무도 버튼을 누르지 않음(timedOut, 0표)
 *   -> classifyOutcome === "host-timeout"
 *   -> resolveCouncilDecision 이 호스트에게 폴백 프롬프트(askHost)를 보냄
 *      (정확한 타임아웃 사유 문구 + 호스트 userId 전달)
 *   -> 호스트가 직접 고른 답이 그대로 Claude 에 주입됨
 *
 * 다른 폴백 트리거(정족수 미달/동점)는 형제 슬라이스가 다루며,
 * 여기서는 "전체 타임아웃 + 무응답" 트리거만 격리해 검증한다.
 */

const rules: VoteRules = {
  // 기본 3분 타임아웃 규칙을 그대로 사용 (AC 의 "3 minutes")
  timeoutMs: DEFAULT_RULES.timeoutMs,
  quorumRatio: DEFAULT_RULES.quorumRatio,
  hostUserId: "host-1",
};

const question: CouncilQuestion = {
  question: "배포 전략은?",
  header: "배포",
  options: [{ label: "롤링" }, { label: "블루그린" }, { label: "카나리" }],
};

// 제한 시간 동안 아무 버튼 클릭도 수집되지 않은(timedOut) 채널을 모사
function silentChannel(memberIds: string[]): VoteChannel {
  return {
    memberIds: async () => memberIds,
    postAndCollect: async (): Promise<CollectResult> => ({
      interactions: [],
      timedOut: true,
    }),
  };
}

describe("기본 타임아웃이 3분(180_000ms)인지", () => {
  it("DEFAULT_RULES.timeoutMs 는 3분이다", () => {
    expect(DEFAULT_RULES.timeoutMs).toBe(180_000);
    expect(DEFAULT_RULES.timeoutMs).toBe(3 * 60 * 1000);
  });
});

describe("classifyOutcome: 타임아웃 + 무응답", () => {
  it("제한 시간 내 0표면 host-timeout 으로 분류한다", () => {
    const outcome = classifyOutcome({
      votes: [],
      participantCount: 5,
      rules,
      timedOut: true,
    });
    expect(outcome).toBe("host-timeout");
  });
});

describe("fallbackReason: 타임아웃 사유 문구", () => {
  it("host-timeout 은 타임아웃 무응답을 알리는 문구를 준다", () => {
    const reason = fallbackReason("host-timeout");
    expect(reason).toContain("타임아웃");
    expect(reason).toContain("아무도");
  });
});

describe("resolveCouncilDecision: 타임아웃 무응답 -> 호스트 폴백", () => {
  it("호스트에게 타임아웃 사유로 폴백 프롬프트를 보내고 호스트 답을 채택한다", async () => {
    const adapter = new DiscordAdapter(silentChannel(["u1", "u2", "u3"]));
    // DiscordAdapter.askHost 는 형제 슬라이스에서 실제 Discord 연동으로 채워진다.
    // 여기서는 호스트 응답을 스파이로 모사해 "프롬프트 전달 + 직접 응답"만 격리 검증한다.
    const askHost = vi.fn(async () => "블루그린");
    adapter.askHost = askHost;

    const result = await resolveCouncilDecision(question, adapter, rules);

    // 호스트가 폴백 프롬프트를 받았다: (질문, 호스트 ID, 타임아웃 사유)
    expect(askHost).toHaveBeenCalledTimes(1);
    const [askedQuestion, askedHostId, askedReason] = askHost.mock.calls[0];
    expect(askedQuestion).toEqual(question);
    expect(askedHostId).toBe("host-1");
    expect(askedReason).toContain("타임아웃");

    // 호스트가 직접 고른 답이 그대로 채택된다
    expect(result).toEqual({
      choice: "블루그린",
      outcome: "host-timeout",
      contested: true,
    });
  });
});

describe("E2E: 타임아웃 무응답 -> 호스트 답 주입", () => {
  it("아무도 투표하지 않으면 호스트 답이 answers 로 Claude 에 주입된다", async () => {
    const adapter = new DiscordAdapter(silentChannel(["u1", "u2", "u3"]));
    const askHost = vi.fn(async () => "카나리");
    adapter.askHost = askHost;

    const cb = createCanUseTool(adapter, rules);
    const res = await cb(INTERCEPTED_TOOL_NAME, { questions: [question] });

    // 폴백 프롬프트가 호스트에게 전달됐다
    expect(askHost).toHaveBeenCalledTimes(1);
    expect(askHost.mock.calls[0][2]).toContain("타임아웃");

    expect(res.behavior).toBe("allow");
    if (res.behavior === "allow") {
      // 원본 questions 보존 + 호스트가 직접 답한 값 주입
      expect(res.updatedInput.questions).toEqual([question]);
      expect(res.updatedInput.answers).toEqual({ "배포 전략은?": "카나리" });
    }
  });

  it("투표가 정상 성립하면(과반) 호스트 폴백 프롬프트는 발생하지 않는다 (트리거 격리)", async () => {
    // 멤버 2명 전원 투표 -> 정족수 충족 + 과반, 타임아웃 폴백 미발생
    const channel: VoteChannel = {
      memberIds: async () => ["u1", "u2"],
      postAndCollect: async (): Promise<CollectResult> => ({
        interactions: [
          { userId: "u1", customId: "council-vote:0" },
          { userId: "u2", customId: "council-vote:0" },
        ],
        timedOut: false,
      }),
    };
    const adapter = new DiscordAdapter(channel);
    const askHost = vi.fn(async () => "블루그린");
    adapter.askHost = askHost;

    const cb = createCanUseTool(adapter, rules);
    const res = await cb(INTERCEPTED_TOOL_NAME, { questions: [question] });

    expect(askHost).not.toHaveBeenCalled();
    expect(res.behavior).toBe("allow");
    if (res.behavior === "allow") {
      expect(res.updatedInput.answers).toEqual({ "배포 전략은?": "롤링" });
    }
  });
});
