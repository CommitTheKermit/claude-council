import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createCouncilVoteHandler,
  councilVoteInputShape,
  COUNCIL_VOTE_TOOL_NAME,
  type CouncilVoteInput,
} from "../src/mcp/councilTool.js";
import type { MessagingAdapter, PollResult } from "../src/discord/adapter.js";
import type { CouncilQuestion, VoteRules, TallyResult } from "../src/council/types.js";
import * as canUseTool from "../src/council/canUseTool.js";

// 코어 canUseTool 모듈은 그대로 두되(소스 변경 없음), host-fallback 분기 검증을 위해
// spyOn 으로 resolveCouncilDecision 를 일시 대체할 수 있도록 모듈을 모킹 가능 상태로 둔다.
vi.mock("../src/council/canUseTool.js", async (importOriginal) => {
  return await importOriginal<typeof import("../src/council/canUseTool.js")>();
});

const rules: VoteRules = {
  timeoutMs: 180_000,
  quorumRatio: 0.5,
  hostUserId: "host-1",
};

const sampleInput: CouncilVoteInput = {
  question: "다음 작업으로 무엇을 할까?",
  header: "스프린트 결정",
  options: [{ label: "A", description: "옵션 A" }, { label: "B" }],
};

// poll/askHost 를 제어 가능한 mock 어댑터.
function mockAdapter(opts: {
  poll: PollResult;
  hostChoice?: string;
}): MessagingAdapter {
  return {
    poll: async () => opts.poll,
    askHost: async () => opts.hostChoice ?? "A",
  };
}

describe("councilVoteInputShape (AC: zod raw shape)", () => {
  it("question/header/options 키를 가진 raw shape 이다", () => {
    expect(Object.keys(councilVoteInputShape).sort()).toEqual([
      "header",
      "options",
      "question",
    ]);
  });

  it("question 은 필수 문자열, header 는 선택 문자열", () => {
    expect(councilVoteInputShape.question.safeParse("x").success).toBe(true);
    expect(councilVoteInputShape.question.safeParse(123).success).toBe(false);
    expect(councilVoteInputShape.header.safeParse(undefined).success).toBe(true);
    expect(councilVoteInputShape.header.safeParse("ctx").success).toBe(true);
  });

  it("options 는 label/optional description 객체 배열이며 최소 2개", () => {
    const ok = councilVoteInputShape.options.safeParse([
      { label: "A", description: "d" },
      { label: "B" },
    ]);
    expect(ok.success).toBe(true);

    const tooFew = councilVoteInputShape.options.safeParse([{ label: "A" }]);
    expect(tooFew.success).toBe(false);

    const missingLabel = councilVoteInputShape.options.safeParse([
      { description: "no label" },
      { label: "B" },
    ]);
    expect(missingLabel.success).toBe(false);
  });

  it("도구 이름은 council_vote", () => {
    expect(COUNCIL_VOTE_TOOL_NAME).toBe("council_vote");
  });
});

describe("createCouncilVoteHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("정족수 충족 + 단독 최다득표 -> majority, fallback none", async () => {
    const poll: PollResult = {
      votes: [
        { userId: "u1", choice: "A" },
        { userId: "u2", choice: "A" },
        { userId: "u3", choice: "B" },
      ],
      participantCount: 4,
      timedOut: false,
    };
    const handler = createCouncilVoteHandler(mockAdapter({ poll }), rules);
    const res = await handler(sampleInput);

    expect(res.isError).toBeUndefined();
    const text = res.content[0].text;
    expect(text).toContain("Result: A");
    expect(text).toContain("Outcome: majority");
    expect(text).toContain("Votes: 3/4 (quorum met)");
    expect(text).toContain("Fallback: none");
    // 정확히 4줄 템플릿
    expect(text.split("\n")).toHaveLength(4);
  });

  it("정족수 충족 + 동점 -> tie, 호스트 폴백", async () => {
    const poll: PollResult = {
      votes: [
        { userId: "u1", choice: "A" },
        { userId: "u2", choice: "B" },
      ],
      participantCount: 4,
      timedOut: false,
    };
    const handler = createCouncilVoteHandler(
      mockAdapter({ poll, hostChoice: "B" }),
      rules,
    );
    const res = await handler(sampleInput);

    const text = res.content[0].text;
    expect(text).toContain("Result: B");
    expect(text).toContain("Outcome: tie");
    expect(text).toContain("Fallback: host");
  });

  it("정족수 미달 -> no-quorum, 호스트 폴백", async () => {
    const poll: PollResult = {
      votes: [{ userId: "u1", choice: "A" }],
      participantCount: 4,
      timedOut: false,
    };
    const handler = createCouncilVoteHandler(
      mockAdapter({ poll, hostChoice: "A" }),
      rules,
    );
    const res = await handler(sampleInput);

    const text = res.content[0].text;
    expect(text).toContain("Outcome: no-quorum");
    expect(text).toContain("Votes: 1/4 (quorum not met)");
    expect(text).toContain("Fallback: host");
  });

  it("타임아웃 + 무응답 -> timeout, 호스트 폴백", async () => {
    const poll: PollResult = {
      votes: [],
      participantCount: 4,
      timedOut: true,
    };
    const handler = createCouncilVoteHandler(
      mockAdapter({ poll, hostChoice: "A" }),
      rules,
    );
    const res = await handler(sampleInput);

    const text = res.content[0].text;
    expect(text).toContain("Outcome: timeout");
    expect(text).toContain("Fallback: host");
  });

  it("알 수 없는(분류 외) 결과 -> host-fallback, 호스트 폴백", async () => {
    // 코어가 향후/예외적으로 4종 외 outcome 을 돌려주는 경우의 방어적 매핑 검증.
    // resolveCouncilDecision 를 일시 대체해 default 분기(host-fallback)를 강제한다.
    const fallbackResult = {
      choice: "C",
      outcome: "host-escalation" as TallyResult["outcome"],
      contested: true,
    };
    vi.spyOn(canUseTool, "resolveCouncilDecision").mockResolvedValue(
      fallbackResult,
    );

    const poll: PollResult = {
      votes: [{ userId: "u1", choice: "C" }],
      participantCount: 2,
      timedOut: false,
    };
    const handler = createCouncilVoteHandler(mockAdapter({ poll }), rules);
    const res = await handler(sampleInput);

    expect(res.isError).toBeUndefined();
    const text = res.content[0].text;
    expect(text).toContain("Result: C");
    expect(text).toContain("Outcome: host-fallback");
    expect(text).toContain("Fallback: host");
    expect(text.split("\n")).toHaveLength(4);
  });

  it("런타임 오류는 throw 하지 않고 isError=true 콘텐츠로 반환한다", async () => {
    const failing: MessagingAdapter = {
      poll: async () => {
        throw new Error("discord 채널 접근 실패");
      },
      askHost: async () => "A",
    };
    const handler = createCouncilVoteHandler(failing, rules);
    const res = await handler(sampleInput);

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("discord 채널 접근 실패");
  });

  it("timeoutMs 는 핸들러 팩토리에 주입된 rules 에서 가져온다 (기본 180000)", () => {
    let captured: VoteRules | undefined;
    const capturing: MessagingAdapter = {
      poll: async (_q: CouncilQuestion, r: VoteRules) => {
        captured = r;
        return { votes: [], participantCount: 0, timedOut: true };
      },
      askHost: async () => "A",
    };
    const handler = createCouncilVoteHandler(capturing, rules);
    return handler(sampleInput).then(() => {
      expect(captured?.timeoutMs).toBe(180_000);
    });
  });
});
