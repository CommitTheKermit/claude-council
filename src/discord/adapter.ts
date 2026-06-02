import type { CouncilQuestion, Vote } from "../council/types.js";
import {
  buildVoteMessage,
  buildHostPromptMessage,
  parseCustomId,
  type VoteMessagePayload,
} from "./voteMessage.js";

// 호스트 폴백 결정의 기본 제한 시간(ms). 투표 타임아웃과 동일한 3분.
const DEFAULT_HOST_TIMEOUT_MS = 180_000;

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

// 버튼 클릭 한 건 (실제 Discord ButtonInteraction 에서 추출한 최소 정보)
export interface RawButtonVote {
  // 클릭한 사용자 ID
  userId: string;
  // 클릭된 버튼의 customId (예: "council-vote:0")
  customId: string;
}

// 버튼 투표 메시지 게시 후 수집된 클릭들
export interface CollectResult {
  interactions: RawButtonVote[];
  timedOut: boolean;
}

/**
 * 실제 Discord API와 단위 테스트를 분리하기 위한 채널 포트.
 * DiscordAdapter 는 이 포트만 사용하므로, 테스트에서는 mock 으로 주입할 수 있다.
 */
export interface VoteChannel {
  // 정족수 기준이 되는 채널 멤버(투표 가능 인원) ID 목록
  memberIds(): Promise<string[]>;
  // 버튼 투표 메시지를 채널에 게시하고 timeoutMs 동안 버튼 클릭을 수집
  postAndCollect(payload: VoteMessagePayload, timeoutMs: number): Promise<CollectResult>;
  // 호스트 폴백 메시지를 게시하고 hostUserId 의 첫 버튼 클릭을 timeoutMs 동안 기다린다.
  // 호스트가 제한 시간 내 응답하지 않으면 null 을 반환한다.
  postAndAwaitHost(
    payload: VoteMessagePayload,
    hostUserId: string,
    timeoutMs: number,
  ): Promise<RawButtonVote | null>;
}

/**
 * Discord 버튼 투표 어댑터.
 * 가로챈 객관식 질문을 버튼 메시지로 만들어 채널에 포워딩하고,
 * 수집된 버튼 클릭을 선택지 label 단위 표(Vote)로 변환한다.
 * 실제 discord.js 연동은 VoteChannel 구현체에 위임해 단위 테스트 가능하게 한다.
 */
export class DiscordAdapter implements MessagingAdapter {
  // hostTimeoutMs: 호스트 폴백 결정의 제한 시간(미지정 시 투표와 동일한 기본 3분).
  constructor(
    private readonly channel: VoteChannel,
    private readonly hostTimeoutMs: number = DEFAULT_HOST_TIMEOUT_MS,
  ) {}

  async poll(question: CouncilQuestion, timeoutMs: number): Promise<PollResult> {
    const memberIds = await this.channel.memberIds();
    const memberSet = new Set(memberIds);

    // 질문을 버튼 투표 메시지로 만들어 채널에 포워딩하고 클릭을 모은다.
    const payload = buildVoteMessage(question);
    const { interactions, timedOut } = await this.channel.postAndCollect(payload, timeoutMs);

    const votes: Vote[] = [];
    for (const raw of interactions) {
      const index = parseCustomId(raw.customId);
      // 투표 버튼이 아니거나 범위를 벗어난 customId 는 무시
      if (index === null || index < 0 || index >= question.options.length) continue;
      // 채널 멤버만 투표 가능 (멤버십 검증)
      if (!memberSet.has(raw.userId)) continue;
      votes.push({ userId: raw.userId, choice: question.options[index].label });
    }

    return { votes, timedOut, participantCount: memberIds.length };
  }

  /**
   * 폴백 사유와 함께 호스트에게 최종 결정을 요청한다.
   * 호스트가 버튼을 누르면 해당 선택지 label 을, 무응답이면 첫 선택지 label 로
   * 안전 폴백해 세션이 멈추지 않게 한다(tallyVotes 는 hostChoice 가 반드시 필요).
   */
  async askHost(
    question: CouncilQuestion,
    hostUserId: string,
    reason: string,
  ): Promise<string> {
    const payload = buildHostPromptMessage(question, reason);
    const click = await this.channel.postAndAwaitHost(payload, hostUserId, this.hostTimeoutMs);

    if (click) {
      const index = parseCustomId(click.customId);
      if (index !== null && index >= 0 && index < question.options.length) {
        return question.options[index].label;
      }
    }

    // 호스트 무응답/무효 클릭 -> 첫 선택지로 안전 폴백
    return question.options[0].label;
  }
}
