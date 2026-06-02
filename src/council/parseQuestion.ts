import type { CouncilQuestion } from "./types.js";

/**
 * Agent SDK AskUserQuestion 도구가 canUseTool 콜백에 넘기는 원시 입력의 형태.
 * SDK는 questions 배열을 주며, 각 질문은 question/header/multiSelect/options 를 가진다.
 * 신뢰할 수 없는 외부 입력이므로 unknown 으로 받아 런타임 검증한다.
 */
export interface RawAskUserQuestionInput {
  questions: RawQuestion[];
}

interface RawQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: RawOption[];
}

interface RawOption {
  label: string;
  description?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// 하나의 객관식 선택지를 검증/추출한다. label 은 필수, description 은 선택.
function parseOption(raw: unknown, qIndex: number, oIndex: number): CouncilQuestion["options"][number] {
  if (!isObject(raw)) {
    throw new Error(`questions[${qIndex}].options[${oIndex}] 가 객체가 아닙니다.`);
  }
  if (typeof raw.label !== "string" || raw.label.length === 0) {
    throw new Error(`questions[${qIndex}].options[${oIndex}].label 가 비어있거나 문자열이 아닙니다.`);
  }
  const option: CouncilQuestion["options"][number] = { label: raw.label };
  if (typeof raw.description === "string") {
    option.description = raw.description;
  }
  return option;
}

// 하나의 질문(객관식)을 검증/추출한다.
function parseQuestion(raw: unknown, qIndex: number): CouncilQuestion {
  if (!isObject(raw)) {
    throw new Error(`questions[${qIndex}] 가 객체가 아닙니다.`);
  }
  if (typeof raw.question !== "string" || raw.question.length === 0) {
    throw new Error(`questions[${qIndex}].question 가 비어있거나 문자열이 아닙니다.`);
  }
  if (!Array.isArray(raw.options) || raw.options.length === 0) {
    // MVP는 객관식(선택지 존재)만 지원한다. 선택지가 없으면 가로챌 수 없다.
    throw new Error(`questions[${qIndex}].options 가 비어있습니다. MVP는 객관식 질문만 지원합니다.`);
  }

  return {
    question: raw.question,
    header: typeof raw.header === "string" ? raw.header : "",
    options: raw.options.map((opt, oIndex) => parseOption(opt, qIndex, oIndex)),
  };
}

/**
 * 가로챈 AskUserQuestion 도구의 원시 입력 payload 에서
 * 객관식 옵션(질문 텍스트 + 선택지 목록)을 구조화해 추출한다.
 *
 * @param input canUseTool 콜백이 받은 원시 도구 입력 (신뢰 불가)
 * @returns 검증된 CouncilQuestion 배열 (각 질문: question/header/options)
 * @throws payload 가 객관식 AskUserQuestion 형태가 아니면 명확한 에러를 던진다.
 */
export function parseAskUserQuestionInput(input: unknown): CouncilQuestion[] {
  if (!isObject(input)) {
    throw new Error("AskUserQuestion 입력이 객체가 아닙니다.");
  }
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new Error("AskUserQuestion 입력에 questions 배열이 없거나 비어있습니다.");
  }
  return input.questions.map((q, qIndex) => parseQuestion(q, qIndex));
}
