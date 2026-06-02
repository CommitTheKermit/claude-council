import { describe, it, expect, vi } from "vitest";
import { ComponentType, type Client } from "discord.js";
import { DiscordVoteChannel } from "../src/discord/discordVoteChannel.js";
import { CUSTOM_ID_PREFIX } from "../src/discord/voteMessage.js";
import type { VoteMessagePayload } from "../src/discord/voteMessage.js";

/**
 * AC: "Unit/integration tests with mocked Discord API cover vote tallying,
 *      timeout, and host fallback paths"
 *
 * 형제 슬라이스의 테스트들은 VoteChannel "포트"를 mock 으로 갈아끼워
 * 집계/타임아웃/호스트 폴백을 검증했다. 이 슬라이스는 그 포트의 실제 구현인
 * DiscordVoteChannel 이 실제 discord.js Client API(채널 fetch, 멤버 필터,
 * 메시지 send, 버튼 콜렉터)를 어떻게 다루는지를 "Discord API mock" 으로 검증한다.
 *
 * 즉, 가짜 discord.js Client 를 주입해:
 *   - 멤버십 검증(봇 제외)이 정족수 기준 인원에 반영되는지
 *   - 버튼 클릭이 RawButtonVote 로 변환되고 ACK(deferUpdate)되는지
 *   - 콜렉터 종료 사유가 timedOut 플래그로 정확히 매핑되는지(타임아웃 경로)
 * 를 라이브 연동 없이 검증한다.
 */

// ---- 가짜 discord.js 빌딩 블록 -------------------------------------------

// 버튼 클릭 한 건을 모사 (실제 ButtonInteraction 의 최소 표면)
function fakeClick(userId: string, customId: string) {
  return {
    user: { id: userId },
    customId,
    deferUpdate: vi.fn(async () => undefined),
  };
}

type FakeClick = ReturnType<typeof fakeClick>;

// createMessageComponentCollector 가 반환하는 콜렉터를 모사한다.
// DiscordVoteChannel 은 "collect" 를 먼저, "end" 를 나중에 등록하므로
// "end" 등록 시점엔 collect 핸들러가 이미 존재한다. 그 시점에 클릭들을
// 순서대로 흘린 뒤 지정한 사유로 콜렉션을 마감한다.
function fakeCollector(clicks: FakeClick[], endReason: string) {
  const handlers: Record<string, ((...a: unknown[]) => void) | undefined> = {};
  const collector = {
    on(event: string, handler: (...a: unknown[]) => void) {
      handlers[event] = handler;
      if (event === "end") {
        for (const click of clicks) handlers.collect?.(click);
        handler([], endReason);
      }
      return collector;
    },
    // postAndAwaitHost 는 첫 호스트 클릭 후 stop() 을 호출한다(여기선 no-op).
    stop(_reason?: string) {
      void _reason;
    },
  };
  return collector;
}

// 텍스트 채널을 모사. members(봇 포함)와 send() 를 갖는다.
// send() 는 createMessageComponentCollector 를 가진 메시지를 돌려준다.
function fakeTextChannel(opts: {
  members: { id: string; bot: boolean }[];
  clicks?: FakeClick[];
  endReason?: string;
}) {
  const memberMap = new Map(
    opts.members.map((m) => [m.id, { id: m.id, user: { bot: m.bot } }]),
  );
  // 콜렉터 생성 시 넘어온 옵션을 캡처해 별도 검증한다(componentType/time/filter).
  const collectorSpy = vi.fn((collectorOpts: unknown) => {
    void collectorOpts;
    return fakeCollector(opts.clicks ?? [], opts.endReason ?? "time");
  });
  // 진행 상황 라이브 갱신(message.edit) 호출을 캡처한다.
  const editSpy = vi.fn(async (payload: unknown) => {
    void payload;
    return undefined;
  });
  const send = vi.fn(async (payload: unknown) => {
    void payload;
    return { createMessageComponentCollector: collectorSpy, edit: editSpy };
  });
  return { members: memberMap, send, collectorSpy, editSpy };
}

// channels.fetch 가 주어진 채널을 돌려주는 가짜 Client 를 만든다.
function fakeClient(fetched: unknown): Client {
  const fetch = vi.fn(async (_id: string) => fetched);
  return { channels: { fetch } } as unknown as Client;
}

const payload: VoteMessagePayload = {
  // 실제 페이로드 형태는 voteMessage 테스트가 검증하므로 여기선 통과만 확인
  embeds: [{ toJSON: () => ({}) } as never],
  components: [{ toJSON: () => ({}) } as never],
};

// ---- memberIds: 멤버십 검증(봇 제외) -------------------------------------

describe("DiscordVoteChannel.memberIds - Discord 멤버십 검증", () => {
  it("봇을 제외한 채널 멤버 ID 만 정족수 기준 인원으로 반환한다", async () => {
    const channel = fakeTextChannel({
      members: [
        { id: "human-1", bot: false },
        { id: "bot-1", bot: true },
        { id: "human-2", bot: false },
      ],
    });
    const client = fakeClient(channel);
    const vc = new DiscordVoteChannel(client, "chan-1");

    const ids = await vc.memberIds();

    expect(ids).toEqual(["human-1", "human-2"]);
    expect(client.channels.fetch).toHaveBeenCalledWith("chan-1");
  });

  it("멤버 목록을 가질 수 없는 채널이면 명확히 에러를 던진다", async () => {
    // members 속성이 없는 채널(예: DM/카테고리) 모사
    const client = fakeClient({ send: () => undefined });
    const vc = new DiscordVoteChannel(client, "chan-x");

    await expect(vc.memberIds()).rejects.toThrow(/멤버 목록/);
  });

  it("채널을 찾을 수 없으면(null) 에러를 던진다", async () => {
    const client = fakeClient(null);
    const vc = new DiscordVoteChannel(client, "missing");

    await expect(vc.memberIds()).rejects.toThrow(/멤버 목록/);
  });
});

// ---- postAndCollect: 게시 + 버튼 클릭 수집 -------------------------------

describe("DiscordVoteChannel.postAndCollect - 게시/수집(Discord API mock)", () => {
  it("페이로드를 채널에 게시하고 콜렉터를 timeoutMs/Button 으로 구성한다", async () => {
    const channel = fakeTextChannel({ members: [], endReason: "time" });
    const client = fakeClient(channel);
    const vc = new DiscordVoteChannel(client, "chan-1");

    await vc.postAndCollect(payload, 4_321);

    // 임베드+버튼 페이로드가 send 로 게시됐다
    expect(channel.send).toHaveBeenCalledOnce();
    expect(channel.send.mock.calls[0][0]).toMatchObject({
      embeds: payload.embeds,
      components: payload.components,
    });
    // 콜렉터는 버튼 컴포넌트 + 주어진 제한 시간으로 구성된다
    const collectorOpts = channel.collectorSpy.mock.calls[0][0] as {
      componentType: number;
      time: number;
      filter: (i: unknown) => boolean;
    };
    expect(collectorOpts.componentType).toBe(ComponentType.Button);
    expect(collectorOpts.time).toBe(4_321);
    // 필터는 투표 버튼 customId 만 통과시킨다
    expect(collectorOpts.filter({ customId: `${CUSTOM_ID_PREFIX}:0` })).toBe(true);
    expect(collectorOpts.filter({ customId: "other:0" })).toBe(false);
    expect(collectorOpts.filter({})).toBe(false);
  });

  it("버튼 클릭을 RawButtonVote 로 변환하고 각 클릭을 ACK(deferUpdate)한다", async () => {
    const clicks = [
      fakeClick("u1", `${CUSTOM_ID_PREFIX}:0`),
      fakeClick("u2", `${CUSTOM_ID_PREFIX}:1`),
    ];
    const channel = fakeTextChannel({ members: [], clicks, endReason: "user" });
    const client = fakeClient(channel);
    const vc = new DiscordVoteChannel(client, "chan-1");

    const result = await vc.postAndCollect(payload, 1_000);

    expect(result.interactions).toEqual([
      { userId: "u1", customId: `${CUSTOM_ID_PREFIX}:0` },
      { userId: "u2", customId: `${CUSTOM_ID_PREFIX}:1` },
    ]);
    // "상호작용 실패" 표시를 막기 위해 모든 클릭을 ACK 했다
    for (const click of clicks) {
      expect(click.deferUpdate).toHaveBeenCalledOnce();
    }
  });

  it("콜렉터가 제한 시간으로 끝나면 timedOut=true (타임아웃 경로)", async () => {
    const channel = fakeTextChannel({ members: [], clicks: [], endReason: "time" });
    const vc = new DiscordVoteChannel(fakeClient(channel), "chan-1");

    const result = await vc.postAndCollect(payload, 500);

    expect(result.timedOut).toBe(true);
    expect(result.interactions).toEqual([]);
  });

  it("클릭마다 onProgress 결과로 메시지를 수정해 진행 상황을 라이브 갱신한다", async () => {
    const clicks = [
      fakeClick("u1", `${CUSTOM_ID_PREFIX}:0`),
      fakeClick("u2", `${CUSTOM_ID_PREFIX}:1`),
    ];
    const channel = fakeTextChannel({ members: [], clicks, endReason: "user" });
    const vc = new DiscordVoteChannel(fakeClient(channel), "chan-1");

    // onProgress 는 현재까지의 클릭 수를 임베드로 돌려준다(렌더 형태는 무관, 호출만 검증).
    const onProgress = vi.fn((raws: { userId: string; customId: string }[]) => ({
      embeds: [{ toJSON: () => ({ n: raws.length }) } as never],
      components: [],
    }));

    await vc.postAndCollect(payload, 1_000, onProgress);

    // 클릭 2건 -> onProgress 2회, message.edit 2회
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(channel.editSpy).toHaveBeenCalledTimes(2);
    // 두 번째 edit 은 누적 클릭 2건이 반영된 페이로드여야 한다
    const secondEdit = channel.editSpy.mock.calls[1][0] as { embeds: { toJSON(): unknown }[] };
    expect(secondEdit.embeds[0].toJSON()).toEqual({ n: 2 });
  });

  it("onProgress 가 없으면 메시지를 수정하지 않는다", async () => {
    const clicks = [fakeClick("u1", `${CUSTOM_ID_PREFIX}:0`)];
    const channel = fakeTextChannel({ members: [], clicks, endReason: "user" });
    const vc = new DiscordVoteChannel(fakeClient(channel), "chan-1");

    await vc.postAndCollect(payload, 1_000);

    expect(channel.editSpy).not.toHaveBeenCalled();
  });

  it("콜렉터가 제한 시간 외 사유로 끝나면 timedOut=false", async () => {
    const channel = fakeTextChannel({
      members: [],
      clicks: [fakeClick("u1", `${CUSTOM_ID_PREFIX}:0`)],
      endReason: "limit",
    });
    const vc = new DiscordVoteChannel(fakeClient(channel), "chan-1");

    const result = await vc.postAndCollect(payload, 500);

    expect(result.timedOut).toBe(false);
    expect(result.interactions).toHaveLength(1);
  });

  it("send 할 수 없는 채널이면 명확히 에러를 던진다", async () => {
    const client = fakeClient({ id: "no-send" });
    const vc = new DiscordVoteChannel(client, "chan-1");

    await expect(vc.postAndCollect(payload, 500)).rejects.toThrow(/메시지를 보낼 수 없/);
  });
});

// ---- postAndAwaitHost: 호스트 폴백 결정 수집(Discord API mock) -------------

describe("DiscordVoteChannel.postAndAwaitHost - 호스트 결정 수집", () => {
  it("콜렉터 필터가 호스트의 투표 버튼 클릭만 통과시킨다", async () => {
    const channel = fakeTextChannel({ members: [], clicks: [], endReason: "time" });
    const vc = new DiscordVoteChannel(fakeClient(channel), "chan-1");

    await vc.postAndAwaitHost(payload, "host-1", 9_000);

    const collectorOpts = channel.collectorSpy.mock.calls[0][0] as {
      componentType: number;
      time: number;
      filter: (i: unknown) => boolean;
    };
    expect(collectorOpts.componentType).toBe(ComponentType.Button);
    expect(collectorOpts.time).toBe(9_000);
    // 호스트가 누른 투표 버튼만 통과한다
    expect(
      collectorOpts.filter({ customId: `${CUSTOM_ID_PREFIX}:0`, user: { id: "host-1" } }),
    ).toBe(true);
    // 다른 멤버의 클릭은 무시
    expect(
      collectorOpts.filter({ customId: `${CUSTOM_ID_PREFIX}:0`, user: { id: "u2" } }),
    ).toBe(false);
    // 투표 버튼이 아니면 무시
    expect(collectorOpts.filter({ customId: "other:0", user: { id: "host-1" } })).toBe(false);
  });

  it("호스트의 첫 클릭을 RawButtonVote 로 돌려주고 ACK 한다", async () => {
    const click = fakeClick("host-1", `${CUSTOM_ID_PREFIX}:1`);
    const channel = fakeTextChannel({ members: [], clicks: [click], endReason: "host-decided" });
    const vc = new DiscordVoteChannel(fakeClient(channel), "chan-1");

    const result = await vc.postAndAwaitHost(payload, "host-1", 9_000);

    expect(result).toEqual({ userId: "host-1", customId: `${CUSTOM_ID_PREFIX}:1` });
    expect(click.deferUpdate).toHaveBeenCalledOnce();
  });

  it("호스트가 응답하지 않고 제한 시간으로 끝나면 null 을 돌려준다", async () => {
    const channel = fakeTextChannel({ members: [], clicks: [], endReason: "time" });
    const vc = new DiscordVoteChannel(fakeClient(channel), "chan-1");

    const result = await vc.postAndAwaitHost(payload, "host-1", 500);

    expect(result).toBeNull();
  });
});
