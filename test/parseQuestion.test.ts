import { describe, it, expect } from "vitest";
import { parseAskUserQuestionInput } from "../src/council/parseQuestion.js";

describe("parseAskUserQuestionInput", () => {
  it("샘플 객관식 payload에서 질문 텍스트와 선택지 목록을 구조화해 추출한다", () => {
    // Agent SDK AskUserQuestion 도구가 canUseTool에 넘기는 실제 형태의 샘플
    const payload = {
      questions: [
        {
          question: "어떤 데이터베이스를 사용할까요?",
          header: "DB 선택",
          multiSelect: false,
          options: [
            { label: "PostgreSQL", description: "관계형, 안정적" },
            { label: "MongoDB", description: "문서형, 유연함" },
            { label: "SQLite" },
          ],
        },
      ],
    };

    const result = parseAskUserQuestionInput(payload);

    expect(result).toEqual([
      {
        question: "어떤 데이터베이스를 사용할까요?",
        header: "DB 선택",
        options: [
          { label: "PostgreSQL", description: "관계형, 안정적" },
          { label: "MongoDB", description: "문서형, 유연함" },
          { label: "SQLite" },
        ],
      },
    ]);
  });

  it("여러 질문이 담긴 payload를 모두 추출한다", () => {
    const payload = {
      questions: [
        { question: "Q1", header: "H1", options: [{ label: "A" }, { label: "B" }] },
        { question: "Q2", header: "H2", options: [{ label: "C" }] },
      ],
    };

    const result = parseAskUserQuestionInput(payload);

    expect(result).toHaveLength(2);
    expect(result[0].question).toBe("Q1");
    expect(result[1].options).toEqual([{ label: "C" }]);
  });

  it("header가 없으면 빈 문자열로 채운다", () => {
    const payload = {
      questions: [{ question: "Q", options: [{ label: "A" }] }],
    };

    const result = parseAskUserQuestionInput(payload);

    expect(result[0].header).toBe("");
  });

  it("questions 배열이 없으면 에러", () => {
    expect(() => parseAskUserQuestionInput({})).toThrowError(/questions/);
  });

  it("questions 배열이 비어있으면 에러", () => {
    expect(() => parseAskUserQuestionInput({ questions: [] })).toThrowError(/questions/);
  });

  it("선택지가 없는 질문(비객관식)이면 에러", () => {
    expect(() =>
      parseAskUserQuestionInput({ questions: [{ question: "Q", options: [] }] }),
    ).toThrowError(/객관식/);
  });

  it("질문 텍스트가 문자열이 아니면 에러", () => {
    expect(() =>
      parseAskUserQuestionInput({ questions: [{ question: 123, options: [{ label: "A" }] }] }),
    ).toThrowError(/question/);
  });

  it("선택지 label이 비어있으면 에러", () => {
    expect(() =>
      parseAskUserQuestionInput({ questions: [{ question: "Q", options: [{ label: "" }] }] }),
    ).toThrowError(/label/);
  });

  it("입력이 객체가 아니면 에러", () => {
    expect(() => parseAskUserQuestionInput(null)).toThrowError(/객체/);
  });
});
