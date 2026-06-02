import { describe, it, expect } from "vitest";
import { ComponentType, ButtonStyle } from "discord.js";
import {
  buildCustomId,
  parseCustomId,
  buildVoteButtons,
  buildVoteActionRows,
  buildVoteEmbed,
  buildVoteMessage,
  CUSTOM_ID_PREFIX,
} from "../src/discord/voteMessage.js";
import type { CouncilQuestion } from "../src/council/types.js";

const question: CouncilQuestion = {
  question: "어떤 데이터베이스를 사용할까요?",
  header: "DB 선택",
  options: [
    { label: "PostgreSQL", description: "관계형, 안정적" },
    { label: "MongoDB", description: "문서형, 유연함" },
    { label: "SQLite" },
  ],
};

describe("customId 인코딩", () => {
  it("선택지 인덱스를 customId 로 인코딩/복원한다", () => {
    expect(buildCustomId(0)).toBe(`${CUSTOM_ID_PREFIX}:0`);
    expect(parseCustomId(buildCustomId(2))).toBe(2);
  });

  it("투표 버튼이 아닌 customId 는 null", () => {
    expect(parseCustomId("other:0")).toBeNull();
    expect(parseCustomId(`${CUSTOM_ID_PREFIX}:abc`)).toBeNull();
  });
});

describe("buildVoteButtons", () => {
  it("각 선택지를 인덱스가 인코딩된 버튼으로 만든다", () => {
    const buttons = buildVoteButtons(question).map((b) => b.toJSON());
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toMatchObject({
      custom_id: `${CUSTOM_ID_PREFIX}:0`,
      label: "PostgreSQL",
      style: ButtonStyle.Primary,
      type: ComponentType.Button,
    });
    expect(buttons[2].custom_id).toBe(`${CUSTOM_ID_PREFIX}:2`);
  });

  it("80자 초과 라벨은 잘라낸다", () => {
    const long = "x".repeat(100);
    const [button] = buildVoteButtons({
      question: "Q",
      header: "",
      options: [{ label: long }],
    });
    expect(button.toJSON().label!.length).toBeLessThanOrEqual(80);
  });

  it("선택지가 25개를 넘으면 에러", () => {
    const options = Array.from({ length: 26 }, (_, i) => ({ label: `opt${i}` }));
    expect(() => buildVoteButtons({ question: "Q", header: "", options })).toThrowError(/한도/);
  });
});

describe("buildVoteActionRows", () => {
  it("버튼을 행당 최대 5개로 묶는다", () => {
    const options = Array.from({ length: 7 }, (_, i) => ({ label: `opt${i}` }));
    const rows = buildVoteActionRows({ question: "Q", header: "", options });
    expect(rows).toHaveLength(2);
    expect(rows[0].toJSON().components).toHaveLength(5);
    expect(rows[1].toJSON().components).toHaveLength(2);
  });
});

describe("buildVoteEmbed", () => {
  it("질문 텍스트와 선택지 설명을 임베드에 담는다", () => {
    const embed = buildVoteEmbed(question).toJSON();
    expect(embed.title).toBe("DB 선택");
    expect(embed.description).toBe("어떤 데이터베이스를 사용할까요?");
    expect(embed.fields).toHaveLength(3);
    expect(embed.fields![0]).toMatchObject({ name: "PostgreSQL", value: "관계형, 안정적" });
  });

  it("header 가 비면 기본 제목을 쓴다", () => {
    const embed = buildVoteEmbed({ question: "Q", header: "", options: [{ label: "A" }] }).toJSON();
    expect(embed.title).toBe("투표");
  });
});

describe("buildVoteMessage", () => {
  it("임베드와 버튼 행을 가진 채널 send 페이로드를 만든다", () => {
    const payload = buildVoteMessage(question);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.components).toHaveLength(1);
    const buttons = payload.components[0].toJSON().components;
    expect(buttons).toHaveLength(3);
  });
});
