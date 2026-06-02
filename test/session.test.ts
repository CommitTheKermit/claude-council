import { describe, it, expect, vi } from "vitest";
import {
  bootstrapSession,
  createCanUseTool,
  isInterceptedTool,
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

describe("isInterceptedTool", () => {
  it("AskUserQuestion 만 가로채기 대상으로 판별한다", () => {
    expect(isInterceptedTool(INTERCEPTED_TOOL_NAME)).toBe(true);
    for (const name of ["Bash", "Read", "Edit", "Write", "Grep", "askuserquestion"]) {
      expect(isInterceptedTool(name)).toBe(false);
    }
  });
});

describe("createCanUseTool", () => {
  it(`${INTERCEPTED_TOOL_NAME} 이외의 도구는 입력 그대로 allow`, async () => {
    const adapter = fakeAdapter({ votes: [], timedOut: false, participantCount: 0 });
    const cb = createCanUseTool(adapter, rules);

    const res = await cb("Bash", { command: "ls" });

    expect(res).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
  });

  it("여러 mock 도구 입력 중 AskUserQuestion 만 가로채고 나머지는 어댑터를 건드리지 않는다", async () => {
    // poll/askHost 호출 여부를 추적하는 스파이 어댑터
    const poll = vi.fn(async () => ({
      votes: [
        { userId: "u1", choice: "A" },
        { userId: "u2", choice: "A" },
      ],
      timedOut: false,
      participantCount: 2,
    }));
    const askHost = vi.fn(async () => "A");
    const adapter: MessagingAdapter = { poll, askHost };
    const cb = createCanUseTool(adapter, rules);

    // 가로채지 않아야 하는 mock tool-use 입력들: 입력이 그대로 통과되고 어댑터 미호출
    const passthrough: Array<[string, Record<string, unknown>]> = [
      ["Bash", { command: "ls" }],
      ["Read", { file_path: "/tmp/x" }],
      ["Edit", { file_path: "/tmp/x", old_string: "a", new_string: "b" }],
      ["WebFetch", { url: "https://example.com" }],
    ];
    for (const [name, input] of passthrough) {
      const res = await cb(name, input);
      expect(res).toEqual({ behavior: "allow", updatedInput: input });
    }
    // 가로채지 않는 도구들에 대해서는 투표/호스트 경로가 전혀 호출되지 않아야 한다
    expect(poll).not.toHaveBeenCalled();
    expect(askHost).not.toHaveBeenCalled();

    // AskUserQuestion 만 가로채져 어댑터(poll)가 호출된다
    const intercepted = await cb(INTERCEPTED_TOOL_NAME, { questions: [sampleQuestion] });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(intercepted.behavior).toBe("allow");
    if (intercepted.behavior === "allow") {
      expect(intercepted.updatedInput.answers).toEqual({ "어떤 색?": "A" });
    }
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
