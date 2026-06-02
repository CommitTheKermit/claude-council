import { Client, ComponentType, type Interaction } from "discord.js";
import type { CollectResult, RawButtonVote, VoteChannel } from "./adapter.js";
import type { VoteMessagePayload } from "./voteMessage.js";
import { CUSTOM_ID_PREFIX } from "./voteMessage.js";

/**
 * discord.js Client 를 사용하는 실제 VoteChannel 구현.
 * 버튼 투표 메시지를 텍스트 채널에 게시하고, 메시지 컴포넌트 콜렉터로 클릭을 수집한다.
 * (이 클래스는 라이브 Discord 연동 경로이며, 단위 테스트는 VoteChannel mock 으로 대체한다.)
 */
export class DiscordVoteChannel implements VoteChannel {
  constructor(
    private readonly client: Client,
    private readonly channelId: string,
  ) {}

  async memberIds(): Promise<string[]> {
    const channel = await this.client.channels.fetch(this.channelId);
    if (!channel || !("members" in channel)) {
      throw new Error(`채널 ${this.channelId} 의 멤버 목록을 가져올 수 없습니다.`);
    }
    // 봇을 제외한 채널 멤버만 투표 가능 인원으로 집계
    const members = channel.members as Map<string, { user: { bot: boolean }; id: string }>;
    const ids: string[] = [];
    for (const member of members.values()) {
      if (!member.user.bot) ids.push(member.id);
    }
    return ids;
  }

  async postAndCollect(payload: VoteMessagePayload, timeoutMs: number): Promise<CollectResult> {
    const channel = await this.client.channels.fetch(this.channelId);
    if (!channel || !("send" in channel) || typeof channel.send !== "function") {
      throw new Error(`채널 ${this.channelId} 에 메시지를 보낼 수 없습니다.`);
    }

    const message = await channel.send({
      embeds: payload.embeds,
      components: payload.components,
    });

    return await new Promise<CollectResult>((resolve) => {
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: timeoutMs,
        filter: (i: Interaction) =>
          "customId" in i && typeof i.customId === "string" && i.customId.startsWith(`${CUSTOM_ID_PREFIX}:`),
      });

      const interactions: RawButtonVote[] = [];
      collector.on("collect", (interaction) => {
        interactions.push({ userId: interaction.user.id, customId: interaction.customId });
        // 클릭을 ACK 해 "상호작용 실패" 표시를 막는다.
        void interaction.deferUpdate().catch(() => undefined);
      });
      collector.on("end", (_collected, reason) => {
        resolve({ interactions, timedOut: reason === "time" });
      });
    });
  }
}
