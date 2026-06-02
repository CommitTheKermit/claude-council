import { describe, it, expect, vi } from "vitest";
import { DiscordAdapter } from "../src/discord/adapter.js";
import type { VoteChannel, CollectResult } from "../src/discord/adapter.js";
import type { VoteMessagePayload } from "../src/discord/voteMessage.js";
import { CUSTOM_ID_PREFIX } from "../src/discord/voteMessage.js";
import type { CouncilQuestion } from "../src/council/types.js";

const question: CouncilQuestion = {
  question: "어떤 색?",
  header: "색상",
  options: [{ label: "빨강" }, { label: "파랑" }],
};

// 게시된 페이로드와 반환할 수집 결과를 제어하는 mock 채널
function mockChannel(memberIds: string[], collect: CollectResult) {
  const posted: VoteMessagePayload[] = [];
  const channel: VoteChannel = {
    memberIds: async () => memberIds,
    postAndCollect: async (payload) => {
      posted.push(payload);
      return collect;
    },
  };
  return { channel, posted };
}

describe("DiscordAdapter.poll - 버튼 투표 포워딩", () => {
  it("질문을 버튼 메시지로 만들어 채널에 포워딩한다", async () => {
    const { channel, posted } = mockChannel(["u1", "u2"], {
      interactions: [],
      timedOut: true,
    });
    const adapter = new DiscordAdapter(channel);

    await adapter.poll(question, 1_000);

    // 한 번 게시되고, 선택지가 버튼으로 렌더된다
    expect(posted).toHaveLength(1);
    const buttons = posted[0].components[0].toJSON().components;
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatchObject({ custom_id: `${CUSTOM_ID_PREFIX}:0`, label: "빨강" });
    expect(buttons[1]).toMatchObject({ custom_id: `${CUSTOM_ID_PREFIX}:1`, label: "파랑" });
    // 질문 텍스트가 임베드로 포함된다
    expect(posted[0].embeds[0].toJSON().description).toBe("어떤 색?");
  });

  it("버튼 클릭(customId)을 선택지 label 표로 변환한다", async () => {
    const { channel } = mockChannel(["u1", "u2", "u3"], {
      interactions: [
        { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:0` },
        { userId: "u2", customId: `${CUSTOM_ID_PREFIX}:1` },
      ],
      timedOut: false,
    });
    const adapter = new DiscordAdapter(channel);

    const result = await adapter.poll(question, 1_000);

    expect(result.participantCount).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.votes).toEqual([
      { userId: "u1", choice: "빨강" },
      { userId: "u2", choice: "파랑" },
    ]);
  });

  it("채널 멤버가 아닌 사용자의 투표는 무시한다", async () => {
    const { channel } = mockChannel(["u1"], {
      interactions: [
        { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:0` },
        { userId: "outsider", customId: `${CUSTOM_ID_PREFIX}:1` },
      ],
      timedOut: false,
    });
    const adapter = new DiscordAdapter(channel);

    const result = await adapter.poll(question, 1_000);

    expect(result.votes).toEqual([{ userId: "u1", choice: "빨강" }]);
  });

  it("범위를 벗어나거나 투표 버튼이 아닌 customId 는 무시한다", async () => {
    const { channel } = mockChannel(["u1", "u2", "u3"], {
      interactions: [
        { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:9` }, // 범위 초과
        { userId: "u2", customId: "other:0" }, // 투표 버튼 아님
        { userId: "u3", customId: `${CUSTOM_ID_PREFIX}:1` }, // 유효
      ],
      timedOut: false,
    });
    const adapter = new DiscordAdapter(channel);

    const result = await adapter.poll(question, 1_000);

    expect(result.votes).toEqual([{ userId: "u3", choice: "파랑" }]);
  });

  it("타임아웃으로 마감되면 timedOut=true 를 전달한다", async () => {
    const collectSpy = vi.fn(async () => ({ interactions: [], timedOut: true }));
    const channel: VoteChannel = {
      memberIds: async () => ["u1", "u2"],
      postAndCollect: collectSpy,
    };
    const adapter = new DiscordAdapter(channel);

    const result = await adapter.poll(question, 500);

    expect(collectSpy).toHaveBeenCalledOnce();
    // 게시 시 timeout 이 그대로 채널에 전달된다
    expect(collectSpy.mock.calls[0][1]).toBe(500);
    expect(result.timedOut).toBe(true);
    expect(result.votes).toEqual([]);
  });
});
