import { describe, it, expect, vi } from "vitest";
import { DiscordAdapter } from "../src/discord/adapter.js";
import type { VoteChannel, CollectResult, RawButtonVote } from "../src/discord/adapter.js";
import type { VoteMessagePayload } from "../src/discord/voteMessage.js";
import { CUSTOM_ID_PREFIX } from "../src/discord/voteMessage.js";
import type { CouncilQuestion, VoteRules } from "../src/council/types.js";

const question: CouncilQuestion = {
  question: "어떤 색?",
  header: "색상",
  options: [{ label: "빨강" }, { label: "파랑" }],
};

// poll 은 이제 VoteRules 를 받는다(timeoutMs + 진행 표시용 quorumRatio).
const rules = (timeoutMs: number, quorumRatio = 0.5): VoteRules => ({
  timeoutMs,
  quorumRatio,
  hostUserId: "host",
});

// 게시된 페이로드와 반환할 수집 결과를 제어하는 mock 채널
function mockChannel(memberIds: string[], collect: CollectResult) {
  const posted: VoteMessagePayload[] = [];
  const channel: VoteChannel = {
    memberIds: async () => memberIds,
    postAndCollect: async (payload) => {
      posted.push(payload);
      return collect;
    },
    postAndAwaitHost: async () => null,
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

    await adapter.poll(question, rules(1_000));

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

    const result = await adapter.poll(question, rules(1_000));

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

    const result = await adapter.poll(question, rules(1_000));

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

    const result = await adapter.poll(question, rules(1_000));

    expect(result.votes).toEqual([{ userId: "u3", choice: "파랑" }]);
  });

  it("타임아웃으로 마감되면 timedOut=true 를 전달한다", async () => {
    const collectSpy = vi.fn(async () => ({ interactions: [], timedOut: true }));
    const channel: VoteChannel = {
      memberIds: async () => ["u1", "u2"],
      postAndCollect: collectSpy,
      postAndAwaitHost: async () => null,
    };
    const adapter = new DiscordAdapter(channel);

    const result = await adapter.poll(question, rules(500));

    expect(collectSpy).toHaveBeenCalledOnce();
    // 게시 시 timeout 이 그대로 채널에 전달된다
    expect(collectSpy.mock.calls[0][1]).toBe(500);
    expect(result.timedOut).toBe(true);
    expect(result.votes).toEqual([]);
  });
});

describe("DiscordAdapter.poll - 진행 상황 라이브 표시", () => {
  // 게시 페이로드와 onProgress 콜백을 캡처하는 mock 채널
  function progressMockChannel(memberIds: string[], collect: CollectResult) {
    const posted: VoteMessagePayload[] = [];
    let captured: ((raws: RawButtonVote[]) => VoteMessagePayload) | undefined;
    const channel: VoteChannel = {
      memberIds: async () => memberIds,
      postAndCollect: async (payload, _timeoutMs, onProgress) => {
        posted.push(payload);
        captured = onProgress;
        return collect;
      },
      postAndAwaitHost: async () => null,
    };
    return { channel, posted, getProgress: () => captured };
  }

  it("게시 시점 푸터에 투표 0명/정족수/참여자 수를 표시한다", async () => {
    const { channel, posted } = progressMockChannel(["u1", "u2", "u3", "u4", "u5"], {
      interactions: [],
      timedOut: true,
    });
    const adapter = new DiscordAdapter(channel);

    // 참여자 5명, 정족수 0.5 -> 필요 인원 ceil(2.5)=3
    await adapter.poll(question, rules(1_000, 0.5));

    expect(posted[0].embeds[0].toJSON().footer?.text).toBe(
      "🗳️ 투표 0명 / 정족수 3명 필요 · 참여자 5명",
    );
  });

  it("클릭이 들어오면 고유 투표 인원으로 푸터를 갱신한다(중복/비멤버 제외)", async () => {
    const { channel, getProgress } = progressMockChannel(["u1", "u2", "u3", "u4", "u5"], {
      interactions: [],
      timedOut: true,
    });
    const adapter = new DiscordAdapter(channel);
    await adapter.poll(question, rules(1_000, 0.5));

    const updated = getProgress()!([
      { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:0` },
      { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:1` }, // 같은 유저 재클릭 -> 1명
      { userId: "u2", customId: `${CUSTOM_ID_PREFIX}:0` },
      { userId: "outsider", customId: `${CUSTOM_ID_PREFIX}:0` }, // 비멤버 -> 제외
    ]);

    expect(updated.embeds[0].toJSON().footer?.text).toBe(
      "🗳️ 투표 2명 / 정족수 3명 필요 · 참여자 5명",
    );
  });
});

describe("DiscordAdapter.askHost - 호스트 폴백 결정", () => {
  // 호스트 결정 메시지를 게시하고, 지정한 클릭을 호스트 응답으로 돌려주는 mock 채널
  function hostMockChannel(hostClick: RawButtonVote | null) {
    const calls: { payload: VoteMessagePayload; hostUserId: string; timeoutMs: number }[] = [];
    const channel: VoteChannel = {
      memberIds: async () => [],
      postAndCollect: async () => ({ interactions: [], timedOut: true }),
      postAndAwaitHost: async (payload, hostUserId, timeoutMs) => {
        calls.push({ payload, hostUserId, timeoutMs });
        return hostClick;
      },
    };
    return { channel, calls };
  }

  it("호스트가 누른 버튼을 선택지 label 로 변환해 반환한다", async () => {
    const { channel, calls } = hostMockChannel({
      userId: "host-1",
      customId: `${CUSTOM_ID_PREFIX}:1`,
    });
    const adapter = new DiscordAdapter(channel);

    const choice = await adapter.askHost(question, "host-1", "동점입니다");

    expect(choice).toBe("파랑");
    // 폴백 사유가 임베드 설명에 포함되고, 호스트/타임아웃이 그대로 전달된다
    expect(calls).toHaveLength(1);
    expect(calls[0].hostUserId).toBe("host-1");
    expect(calls[0].payload.embeds[0].toJSON().description).toContain("동점입니다");
  });

  it("호스트가 응답하지 않으면(null) 첫 선택지로 안전 폴백한다", async () => {
    const { channel } = hostMockChannel(null);
    const adapter = new DiscordAdapter(channel);

    const choice = await adapter.askHost(question, "host-1", "타임아웃");

    expect(choice).toBe("빨강");
  });

  it("호스트 클릭이 범위를 벗어나면 첫 선택지로 안전 폴백한다", async () => {
    const { channel } = hostMockChannel({ userId: "host-1", customId: `${CUSTOM_ID_PREFIX}:9` });
    const adapter = new DiscordAdapter(channel);

    const choice = await adapter.askHost(question, "host-1", "정족수 미달");

    expect(choice).toBe("빨강");
  });

  it("생성자에 준 hostTimeoutMs 를 호스트 결정 제한 시간으로 사용한다", async () => {
    const { channel, calls } = hostMockChannel(null);
    const adapter = new DiscordAdapter(channel, 7_777);

    await adapter.askHost(question, "host-1", "타임아웃");

    expect(calls[0].timeoutMs).toBe(7_777);
  });
});
