import { describe, it, expect, vi } from "vitest";
import { DiscordAdapter } from "../src/discord/adapter.js";
import type { VoteChannel, CollectResult, RawButtonVote } from "../src/discord/adapter.js";
import { CUSTOM_ID_PREFIX } from "../src/discord/voteMessage.js";
import { createCanUseTool, INTERCEPTED_TOOL_NAME } from "../src/council/session.js";
import type { CouncilQuestion, VoteRules } from "../src/council/types.js";

/**
 * AC: "Participants vote via Discord buttons and majority-voted answer is injected back to Claude"
 *
 * 이 테스트는 끝-에서-끝 경로를 검증한다:
 *   버튼 클릭(customId) -> DiscordAdapter.poll(멤버십 검증 + label 변환)
 *   -> tally(과반 판정) -> canUseTool injection({behavior:"allow", updatedInput:{questions, answers}})
 * 즉, 실제 DiscordAdapter 를 createCanUseTool 에 배선해 합의된 답이 Claude 로 주입되는지 확인한다.
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

// 버튼 클릭과 멤버 목록을 제어하는 mock VoteChannel
function mockChannel(memberIds: string[], interactions: RawButtonVote[], timedOut = false) {
  const channel: VoteChannel = {
    memberIds: async () => memberIds,
    postAndCollect: async (): Promise<CollectResult> => ({ interactions, timedOut }),
  };
  return channel;
}

describe("E2E: 버튼 투표 -> 과반 답 주입", () => {
  it("과반(비만장일치) 버튼 투표의 승자 label 을 answers 로 주입한다", async () => {
    // 멤버 3명, 클릭: 롤링(0) 2표, 블루그린(1) 1표 -> 정족수 3/3 충족, 과반 롤링
    const channel = mockChannel(
      ["u1", "u2", "u3"],
      [
        { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:0` },
        { userId: "u2", customId: `${CUSTOM_ID_PREFIX}:0` },
        { userId: "u3", customId: `${CUSTOM_ID_PREFIX}:1` },
      ],
    );
    const adapter = new DiscordAdapter(channel);
    const cb = createCanUseTool(adapter, rules);

    const res = await cb(INTERCEPTED_TOOL_NAME, { questions: [question] });

    expect(res.behavior).toBe("allow");
    if (res.behavior === "allow") {
      // 원본 questions 가 보존된다 (ontology injectionPayload: {questions, answers})
      expect(res.updatedInput.questions).toEqual([question]);
      // 과반 승자 label 이 질문 텍스트 키로 주입된다
      expect(res.updatedInput.answers).toEqual({ "배포 전략은?": "롤링" });
    }
  });

  it("마지막 표 우선 규칙으로 마음을 바꾼 표가 과반 결과를 뒤집는다", async () => {
    // u1 이 0->1 로 변경. 최종: 블루그린(1) 2표(u1,u2), 롤링(0) 1표(u3)
    const channel = mockChannel(
      ["u1", "u2", "u3"],
      [
        { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:0` },
        { userId: "u2", customId: `${CUSTOM_ID_PREFIX}:1` },
        { userId: "u3", customId: `${CUSTOM_ID_PREFIX}:0` },
        { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:1` }, // u1 마음 바꿈
      ],
    );
    const adapter = new DiscordAdapter(channel);
    const cb = createCanUseTool(adapter, rules);

    const res = await cb(INTERCEPTED_TOOL_NAME, { questions: [question] });

    expect(res.behavior).toBe("allow");
    if (res.behavior === "allow") {
      expect(res.updatedInput.answers).toEqual({ "배포 전략은?": "블루그린" });
    }
  });

  it("채널 비멤버(외부인) 표는 집계에서 제외된 채 과반이 주입된다", async () => {
    // 멤버는 u1,u2 뿐. 외부인 2표가 카나리에 몰려도 무시되고 멤버 과반(롤링)이 이긴다
    const channel = mockChannel(
      ["u1", "u2"],
      [
        { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:0` },
        { userId: "u2", customId: `${CUSTOM_ID_PREFIX}:0` },
        { userId: "outsiderA", customId: `${CUSTOM_ID_PREFIX}:2` },
        { userId: "outsiderB", customId: `${CUSTOM_ID_PREFIX}:2` },
      ],
    );
    const adapter = new DiscordAdapter(channel);
    const cb = createCanUseTool(adapter, rules);

    const res = await cb(INTERCEPTED_TOOL_NAME, { questions: [question] });

    expect(res.behavior).toBe("allow");
    if (res.behavior === "allow") {
      expect(res.updatedInput.answers).toEqual({ "배포 전략은?": "롤링" });
    }
  });

  it("여러 질문 각각의 과반 답을 질문 텍스트별로 주입한다", async () => {
    // postAndCollect 가 질문 순서대로 다른 클릭 묶음을 돌려주도록 큐로 모사
    const queue: CollectResult[] = [
      {
        interactions: [
          { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:0` },
          { userId: "u2", customId: `${CUSTOM_ID_PREFIX}:0` },
        ],
        timedOut: false,
      },
      {
        interactions: [
          { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:1` },
          { userId: "u2", customId: `${CUSTOM_ID_PREFIX}:1` },
        ],
        timedOut: false,
      },
    ];
    const postAndCollect = vi.fn(async () => queue.shift()!);
    const channel: VoteChannel = {
      memberIds: async () => ["u1", "u2"],
      postAndCollect,
    };
    const adapter = new DiscordAdapter(channel);
    const cb = createCanUseTool(adapter, rules);

    const q2: CouncilQuestion = {
      question: "리전은?",
      header: "리전",
      options: [{ label: "서울" }, { label: "도쿄" }],
    };

    const res = await cb(INTERCEPTED_TOOL_NAME, { questions: [question, q2] });

    expect(res.behavior).toBe("allow");
    if (res.behavior === "allow") {
      expect(res.updatedInput.answers).toEqual({
        "배포 전략은?": "롤링",
        "리전은?": "도쿄",
      });
    }
    expect(postAndCollect).toHaveBeenCalledTimes(2);
  });
});
