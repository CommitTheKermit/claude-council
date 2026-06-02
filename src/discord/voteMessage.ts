import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { CouncilQuestion } from "../council/types.js";

// 버튼 customId 접두사. 투표 버튼 클릭을 다른 컴포넌트와 구분하기 위해 사용한다.
export const CUSTOM_ID_PREFIX = "council-vote";

// Discord 제약: 한 행(ActionRow)에 버튼 최대 5개, 메시지당 최대 5행 => 버튼 최대 25개
const MAX_BUTTONS_PER_ROW = 5;
const MAX_ROWS = 5;
const MAX_OPTIONS = MAX_BUTTONS_PER_ROW * MAX_ROWS;
// Discord 버튼 라벨 최대 길이
const MAX_BUTTON_LABEL = 80;

// 선택지 인덱스를 버튼 customId 로 인코딩한다. 예: "council-vote:0"
export function buildCustomId(optionIndex: number, prefix: string = CUSTOM_ID_PREFIX): string {
  return `${prefix}:${optionIndex}`;
}

// 투표 버튼 customId 에서 선택지 인덱스를 복원한다. 투표 버튼이 아니면 null.
export function parseCustomId(customId: string, prefix: string = CUSTOM_ID_PREFIX): number | null {
  const expected = `${prefix}:`;
  if (!customId.startsWith(expected)) return null;
  const raw = customId.slice(expected.length);
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

// 라벨이 Discord 한도를 넘으면 말줄임표로 잘라 안전하게 만든다.
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

// 배열을 size 크기 묶음으로 나눈다 (버튼을 행으로 배치하기 위함).
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// 선택지 개수가 Discord 버튼 한도를 넘는지 검증한다.
function assertWithinLimit(question: CouncilQuestion): void {
  if (question.options.length === 0) {
    throw new Error("선택지가 없는 질문은 버튼 투표로 만들 수 없습니다.");
  }
  if (question.options.length > MAX_OPTIONS) {
    throw new Error(
      `선택지가 ${question.options.length}개로 Discord 버튼 한도(${MAX_OPTIONS}개)를 초과합니다.`,
    );
  }
}

// 각 선택지를 투표 버튼으로 변환한다 (customId 에 인덱스 인코딩).
export function buildVoteButtons(question: CouncilQuestion): ButtonBuilder[] {
  assertWithinLimit(question);
  return question.options.map((opt, index) =>
    new ButtonBuilder()
      .setCustomId(buildCustomId(index))
      .setLabel(truncate(opt.label, MAX_BUTTON_LABEL))
      .setStyle(ButtonStyle.Primary),
  );
}

// 버튼을 Discord 한도(행당 5개)에 맞춰 ActionRow 들로 묶는다.
export function buildVoteActionRows(
  question: CouncilQuestion,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = buildVoteButtons(question);
  return chunk(buttons, MAX_BUTTONS_PER_ROW).map((group) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(...group),
  );
}

// 투표 진행 상황 (푸터에 표시). votedCount 는 지금까지 투표한 고유 인원.
export interface VoteStatus {
  votedCount: number;
  requiredVotes: number;
  participantCount: number;
}

// 진행 상황을 한 줄 문구로 만든다. 예: "🗳️ 투표 2명 / 정족수 3명 필요 · 참여자 5명"
export function voteStatusLine(status: VoteStatus): string {
  return `🗳️ 투표 ${status.votedCount}명 / 정족수 ${status.requiredVotes}명 필요 · 참여자 ${status.participantCount}명`;
}

// 질문 텍스트와 선택지 설명을 보여주는 임베드를 만든다.
// status 가 주어지면 푸터에 투표 진행 상황을 표시한다.
export function buildVoteEmbed(question: CouncilQuestion, status?: VoteStatus): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(question.header && question.header.length > 0 ? question.header : "투표")
    .setDescription(question.question);

  for (const opt of question.options) {
    embed.addFields({
      name: opt.label,
      // 설명이 없으면 빈 필드값으로 zero-width space 사용 (Discord는 빈 문자열 거부)
      value: opt.description && opt.description.length > 0 ? opt.description : "​",
    });
  }
  if (status) {
    embed.setFooter({ text: voteStatusLine(status) });
  }
  return embed;
}

// Discord 채널 send() 에 넘길 메시지 페이로드 (임베드 + 버튼 행).
export interface VoteMessagePayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

// 가로챈 객관식 질문을 Discord 버튼 투표 메시지 페이로드로 변환한다.
// status 가 주어지면 푸터에 투표 진행 상황(투표 인원/정족수/참여자)을 함께 렌더한다.
export function buildVoteMessage(
  question: CouncilQuestion,
  status?: VoteStatus,
): VoteMessagePayload {
  return {
    embeds: [buildVoteEmbed(question, status)],
    components: buildVoteActionRows(question),
  };
}

// 호스트 폴백 메시지의 임베드를 만든다. 폴백 사유를 제목으로 강조하고
// 원 질문/선택지 설명은 투표 임베드와 동일하게 보여준다.
export function buildHostPromptEmbed(question: CouncilQuestion, reason: string): EmbedBuilder {
  const embed = buildVoteEmbed(question);
  embed.setTitle("🛠️ 호스트 결정 필요");
  // 폴백 사유를 원 질문 위에 함께 노출한다.
  embed.setDescription(`${reason}\n\n${question.question}`);
  return embed;
}

// 호스트 폴백 결정 메시지 페이로드를 만든다. 버튼/customId 는 투표와 동일해
// 호스트의 클릭도 같은 방식(parseCustomId)으로 선택지 인덱스를 복원할 수 있다.
export function buildHostPromptMessage(
  question: CouncilQuestion,
  reason: string,
): VoteMessagePayload {
  return {
    embeds: [buildHostPromptEmbed(question, reason)],
    components: buildVoteActionRows(question),
  };
}
