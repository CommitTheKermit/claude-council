import { describe, it, expect, vi } from "vitest";
import { bootstrapSession } from "../src/council/session.js";
import type { QueryFn, QueryParams, PermissionResult } from "../src/council/session.js";
import type { MessagingAdapter, PollResult } from "../src/discord/adapter.js";
import type { CouncilQuestion, VoteRules } from "../src/council/types.js";

/**
 * AC: "Claude resumes work using the injected answer, verified by asserting
 *      canUseTool returns {behavior:allow, updatedInput.answers} with mocked SDK"
 *
 * 다른 테스트(voteInjection)는 createCanUseTool 을 직접 호출해 주입 payload 만 본다.
 * 이 테스트는 한 단계 더 나아가 "Claude 가 주입된 답으로 작업을 재개"하는 루프 전체를
 * mocked SDK 로 재현한다:
 *
 *   bootstrapSession(queryFn 주입)        // 실제 프로덕션 배선 경로 그대로
 *     -> mock SDK 가 AskUserQuestion tool-use 를 만나
 *     -> options 로 배선된 canUseTool 콜백을 호출(실 SDK 동작 모사)
 *     -> {behavior:"allow", updatedInput:{questions, answers}} 를 받고
 *     -> 주입된 answers 로 "작업을 재개"해 최종 결과 메시지를 만든다
 *
 * 검증 포인트:
 *   1) 콜백 반환이 {behavior:"allow"} 이고 updatedInput.answers 가 합의 답을 담는다
 *   2) mock SDK 가 그 answers 를 실제로 소비(재개)해 최종 결과에 반영한다
 *   3) 원본 questions 가 보존된다 (injectionPayload 온톨로지)
 */

const rules: VoteRules = {
  timeoutMs: 1_000,
  quorumRatio: 0.5,
  hostUserId: "host-1",
};

const question: CouncilQuestion = {
  question: "배포 전략은?",
  header: "배포",
  options: [{ label: "롤링" }, { label: "블루그린" }, { label: "카나리" }],
};

// poll 결과를 고정해 주는 가짜 어댑터 (과반 합의를 모사)
function fakeAdapter(poll: PollResult, hostChoice = "롤링"): MessagingAdapter {
  return {
    poll: async () => poll,
    askHost: async () => hostChoice,
  };
}

// mock SDK 가 흘려보내는 메시지 최소 형태
type SdkMessage =
  | { type: "tool_use"; name: string }
  | { type: "permission"; result: PermissionResult }
  | { type: "result"; resumedAnswer: string; text: string };

/**
 * 실제 @anthropic-ai/claude-agent-sdk 의 query() 를 모사하는 mock SDK.
 * 실 SDK 처럼 AskUserQuestion 을 만나면 options.canUseTool 을 호출하고,
 * 허용되면 주입된 answers 로 작업을 "재개"한다.
 *
 * @param toolInput AskUserQuestion 도구가 받았다고 가정할 원시 입력
 */
function createMockSdkQuery(toolInput: Record<string, unknown>): {
  queryFn: QueryFn;
  capturedPermission: () => PermissionResult | undefined;
} {
  let captured: PermissionResult | undefined;

  const queryFn: QueryFn = (params: QueryParams) => {
    const canUseTool = params.options?.canUseTool;
    if (typeof canUseTool !== "function") {
      throw new Error("mock SDK: canUseTool 이 options 에 배선되지 않았습니다.");
    }

    // 실 SDK 의 메시지 스트림(AsyncGenerator)을 모사한다.
    async function* run(): AsyncGenerator<SdkMessage> {
      // 1) 모델이 AskUserQuestion 도구 사용을 시도
      yield { type: "tool_use", name: "AskUserQuestion" };

      // 2) SDK 가 권한 콜백(canUseTool)을 호출 -> 협의/투표로 라우팅됨
      const permission = await canUseTool("AskUserQuestion", toolInput);
      captured = permission;
      yield { type: "permission", result: permission };

      // 3) 허용되면 주입된 answers 로 작업을 재개한다.
      if (permission.behavior !== "allow") {
        return; // deny 면 재개 없이 종료
      }
      const answers = permission.updatedInput.answers as Record<string, string> | undefined;
      const resumedAnswer = answers?.[question.question] ?? "(no-answer)";

      // Claude 가 합의된 답으로 후속 작업을 이어가는 것을 최종 결과로 표현
      yield {
        type: "result",
        resumedAnswer,
        text: `합의된 '${resumedAnswer}' 전략으로 배포를 진행합니다.`,
      };
    }

    return run();
  };

  return { queryFn, capturedPermission: () => captured };
}

describe("mocked SDK: 주입된 답으로 Claude 작업 재개", () => {
  it("canUseTool 이 {behavior:allow, updatedInput.answers} 를 반환하고 SDK 가 그 답으로 재개한다", async () => {
    // 멤버 2명 전원 '롤링' -> 정족수 충족 + 과반 '롤링'
    const adapter = fakeAdapter({
      votes: [
        { userId: "u1", choice: "롤링" },
        { userId: "u2", choice: "롤링" },
      ],
      timedOut: false,
      participantCount: 2,
    });

    const toolInput = { questions: [question] };
    const { queryFn, capturedPermission } = createMockSdkQuery(toolInput);

    // 실제 프로덕션 배선과 동일하게 bootstrapSession 으로 canUseTool 을 SDK 에 주입
    const handle = await bootstrapSession({ prompt: "배포 진행", adapter, rules, queryFn });

    // SDK 메시지 스트림을 끝까지 소비(= 세션 실행)
    const messages: SdkMessage[] = [];
    for await (const msg of handle.query as AsyncIterable<SdkMessage>) {
      messages.push(msg);
    }

    // 1) canUseTool 콜백 반환 형태 검증: {behavior:"allow", updatedInput.answers}
    const permission = capturedPermission();
    expect(permission).toBeDefined();
    expect(permission!.behavior).toBe("allow");
    if (permission!.behavior === "allow") {
      expect(permission!.updatedInput.answers).toEqual({ "배포 전략은?": "롤링" });
      // 원본 questions 보존 (injectionPayload 온톨로지)
      expect(permission!.updatedInput.questions).toEqual([question]);
    }

    // 2) SDK 가 주입된 답을 실제로 소비해 작업을 재개했는지
    const result = messages.find((m): m is Extract<SdkMessage, { type: "result" }> =>
      m.type === "result",
    );
    expect(result).toBeDefined();
    expect(result!.resumedAnswer).toBe("롤링");
    expect(result!.text).toContain("롤링");

    // 3) 스트림 순서: tool_use -> permission(allow) -> result 로 재개
    expect(messages.map((m) => m.type)).toEqual(["tool_use", "permission", "result"]);
  });

  it("호스트 폴백으로 결정된 답도 동일하게 주입되어 Claude 가 재개한다", async () => {
    // 정족수 미달(2명 중 0명 투표) -> 호스트 폴백 '블루그린'
    const adapter = fakeAdapter(
      { votes: [], timedOut: true, participantCount: 2 },
      "블루그린",
    );

    const toolInput = { questions: [question] };
    const { queryFn, capturedPermission } = createMockSdkQuery(toolInput);

    const handle = await bootstrapSession({ prompt: "배포 진행", adapter, rules, queryFn });

    const messages: SdkMessage[] = [];
    for await (const msg of handle.query as AsyncIterable<SdkMessage>) {
      messages.push(msg);
    }

    const permission = capturedPermission();
    expect(permission!.behavior).toBe("allow");
    if (permission!.behavior === "allow") {
      // 폴백 결과(블루그린)가 answers 로 주입된다
      expect(permission!.updatedInput.answers).toEqual({ "배포 전략은?": "블루그린" });
    }

    const result = messages.find((m): m is Extract<SdkMessage, { type: "result" }> =>
      m.type === "result",
    );
    expect(result!.resumedAnswer).toBe("블루그린");
    expect(result!.text).toContain("블루그린");
  });

  it("bootstrapSession 이 canUseTool 을 옵션으로 SDK 에 전달했는지(배선) 확인", async () => {
    const adapter = fakeAdapter({
      votes: [
        { userId: "u1", choice: "롤링" },
        { userId: "u2", choice: "롤링" },
      ],
      timedOut: false,
      participantCount: 2,
    });

    // SDK 호출 인자를 가로채는 스파이
    const inner = createMockSdkQuery({ questions: [question] });
    const spyQueryFn = vi.fn(inner.queryFn);

    const handle = await bootstrapSession({
      prompt: "p",
      adapter,
      rules,
      queryFn: spyQueryFn as unknown as QueryFn,
    });

    // 스트림을 소비해야 mock SDK 내부의 canUseTool 호출이 일어난다
    for await (const _msg of handle.query as AsyncIterable<SdkMessage>) {
      void _msg;
    }

    expect(spyQueryFn).toHaveBeenCalledTimes(1);
    const arg = spyQueryFn.mock.calls[0][0] as QueryParams;
    expect(arg.prompt).toBe("p");
    expect(typeof arg.options?.canUseTool).toBe("function");
    // 실제로 콜백이 호출되어 권한 결과가 캡처됐는지
    expect(inner.capturedPermission()?.behavior).toBe("allow");
  });
});
