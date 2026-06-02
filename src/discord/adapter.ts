import type { CouncilQuestion, Vote } from "../council/types.js";

// 한 질문에 대한 투표 세션 결과 (집계 전 원시 데이터)
export interface PollResult {
  votes: Vote[];
  // 타임아웃으로 마감됐는지
  timedOut: boolean;
  // 정족수 계산 기준 참여자 수 (채널 멤버 수)
  participantCount: number;
}

/**
 * 질문을 외부 채널에 포워딩하고 투표를 수집하는 추상 인터페이스.
 * MVP는 Discord 구현만 제공하지만, 추후 Slack 등으로 확장 가능하도록 분리한다.
 */
export interface MessagingAdapter {
  // 질문/선택지를 채널에 게시하고 timeoutMs 동안 투표를 모아 반환
  poll(question: CouncilQuestion, timeoutMs: number): Promise<PollResult>;
  // 호스트에게 최종 결정을 요청 (폴백 경로)
  askHost(question: CouncilQuestion, hostUserId: string, reason: string): Promise<string>;
}

/**
 * Discord 버튼 투표 구현.
 * TODO: discord.js Client 로 채널에 버튼 메시지 게시, ButtonInteraction 수집,
 *       채널 멤버 수로 participantCount 산정, timeoutMs 후 마감.
 */
export class DiscordAdapter implements MessagingAdapter {
  // eslint 미사용 경고 방지를 위한 placeholder. 실제 구현 시 discord.js Client 주입.
  constructor(private readonly channelId: string) {}

  async poll(_question: CouncilQuestion, _timeoutMs: number): Promise<PollResult> {
    void this.channelId;
    throw new Error("DiscordAdapter.poll 미구현 (다음 슬라이스)");
  }

  async askHost(
    _question: CouncilQuestion,
    _hostUserId: string,
    _reason: string,
  ): Promise<string> {
    throw new Error("DiscordAdapter.askHost 미구현 (다음 슬라이스)");
  }
}
