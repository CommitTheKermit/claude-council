import { describe, it, expect, vi } from "vitest";
import {
  bootstrapSession,
  createCanUseTool,
  INTERCEPTED_TOOL_NAME,
} from "../src/council/session.js";
import type { MessagingAdapter, PollResult } from "../src/discord/adapter.js";
import type { CouncilQuestion, VoteRules } from "../src/council/types.js";

const rules: VoteRules = {
  timeoutMs: 1_000,
  quorumRatio: 0.5,
  hostUserId: "host-1",
};

// poll 결과를 고정해 주는 가짜 어댑터
function fakeAdapter(poll: PollResult, hostChoice = "A"): MessagingAdapter {
  return {
    poll: async () => poll,
    askHost: async () => hostChoice,
  };
}

const sampleQuestion: CouncilQuestion = {
  question: "어떤 색?",
  header: "색상",
  options: [{ label: "A" }, { label: "B" }],
};

describe("bootstrapSession", () => {
  it("주입된 query 함수를 canUseTool 옵션과 함께 호출한다", async () => {
    const queryFn = vi.fn(() => ({ marker: "query-result" }));
    const adapter = fakeAdapter({ votes: [], timedOut: false, participantCount: 0 });

    const handle = await bootstrapSession({
      prompt: "안녕",
      adapter,
      rules,
      queryFn,
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
    const arg = queryFn.mock.calls[0][0] as {
      prompt: string;
      options?: { canUseTool?: unknown };
    };
    expect(arg.prompt).toBe("안녕");
    // 핵심: canUseTool 콜백이 옵션으로 배선되어 SDK에 전달됐는지
    expect(typeof arg.options?.canUseTool).toBe("function");
    expect(handle.query).toEqual({ marker: "query-result" });
    expect(typeof handle.canUseTool).toBe("function");
  });

  it("extraOptions 를 query options 에 병합한다", async () => {
    const queryFn = vi.fn(() => ({}));
    const adapter = fakeAdapter({ votes: [], timedOut: false, participantCount: 0 });

    await bootstrapSession({
      prompt: "p",
      adapter,
      rules,
      queryFn,
      extraOptions: { model: "claude-sonnet" },
    });

    const arg = queryFn.mock.calls[0][0] as { options?: Record<string, unknown> };
    expect(arg.options?.model).toBe("claude-sonnet");
    expect(typeof arg.options?.canUseTool).toBe("function");
  });
});

describe("createCanUseTool", () => {
  it(`${INTERCEPTED_TOOL_NAME} 이외의 도구는 입력 그대로 allow`, async () => {
    const adapter = fakeAdapter({ votes: [], timedOut: false, participantCount: 0 });
    const cb = createCanUseTool(adapter, rules);

    const res = await cb("Bash", { command: "ls" });

    expect(res).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
  });

  it(`${INTERCEPTED_TOOL_NAME} 은 협의 결과를 answers 로 주입한다`, async () => {
    // 2명 중 2명 투표(과반), A 2표 -> majority A
    const adapter = fakeAdapter({
      votes: [
        { userId: "u1", choice: "A" },
        { userId: "u2", choice: "A" },
      ],
      timedOut: false,
      participantCount: 2,
    });
    const cb = createCanUseTool(adapter, rules);

    const res = await cb(INTERCEPTED_TOOL_NAME, { questions: [sampleQuestion] });

    expect(res.behavior).toBe("allow");
    if (res.behavior === "allow") {
      expect(res.updatedInput.answers).toEqual({ "어떤 색?": "A" });
    }
  });
});
