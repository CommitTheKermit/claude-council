import type { VoteRules } from "./types.js";
import type { MessagingAdapter } from "../discord/adapter.js";
import { handleAskUserQuestion } from "./canUseTool.js";

// canUseTool 콜백이 가로채는 도구 이름 (MVP: 객관식 AskUserQuestion만)
export const INTERCEPTED_TOOL_NAME = "AskUserQuestion";

// Agent SDK canUseTool 콜백이 반환해야 하는 PermissionResult의 최소 형태
export type PermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

// Agent SDK canUseTool 콜백 시그니처(최소 형태)
export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options?: unknown,
) => Promise<PermissionResult>;

// Agent SDK query() 에 넘기는 파라미터(최소 형태)
export interface QueryParams {
  prompt: string;
  options?: {
    canUseTool?: CanUseTool;
    [key: string]: unknown;
  };
}

// query() 함수 시그니처 - 테스트에서 주입 가능하도록 추상화
export type QueryFn = (params: QueryParams) => unknown;

export interface BootstrapOptions {
  // Claude Code 세션에 줄 프롬프트
  prompt: string;
  // 질문을 포워딩/집계할 메시징 어댑터 (Discord 등)
  adapter: MessagingAdapter;
  // 투표 규칙 (타임아웃/정족수/호스트)
  rules: VoteRules;
  // 실제 SDK query() 대신 주입할 함수 (테스트용). 미지정 시 SDK를 동적 로드한다.
  queryFn?: QueryFn;
  // query options 에 합쳐줄 추가 옵션 (model, allowedTools 등)
  extraOptions?: Record<string, unknown>;
}

export interface SessionHandle {
  // query()가 돌려준 결과 (SDK 사용 시 AsyncGenerator)
  query: unknown;
  // 배선된 canUseTool 콜백
  canUseTool: CanUseTool;
}

/**
 * AskUserQuestion을 가로채 협의(투표)로 라우팅하는 canUseTool 콜백을 만든다.
 * 가로챈 도구 외에는 입력을 그대로 두고 allow 한다.
 */
export function createCanUseTool(adapter: MessagingAdapter, rules: VoteRules): CanUseTool {
  return async (toolName, input, _options) => {
    if (toolName === INTERCEPTED_TOOL_NAME) {
      // handleAskUserQuestion 은 { behavior:"allow", updatedInput:{...answers} } 를 돌려준다
      const decision = await handleAskUserQuestion(input as never, adapter, rules);
      return {
        behavior: "allow",
        updatedInput: decision.updatedInput as unknown as Record<string, unknown>,
      };
    }
    // 그 외 도구는 기본 통과
    return { behavior: "allow", updatedInput: input };
  };
}

/**
 * Claude Code 세션을 부트스트랩한다.
 * TS Agent SDK의 query()를 canUseTool 콜백과 함께 초기화한다.
 * queryFn 을 주입하면 SDK 없이도 단위 테스트가 가능하다.
 */
export async function bootstrapSession(opts: BootstrapOptions): Promise<SessionHandle> {
  const queryFn = opts.queryFn ?? (await loadSdkQuery());
  const canUseTool = createCanUseTool(opts.adapter, opts.rules);

  const result = queryFn({
    prompt: opts.prompt,
    options: {
      ...opts.extraOptions,
      canUseTool,
    },
  });

  return { query: result, canUseTool };
}

// 실제 SDK의 query() 를 동적 로드한다. (테스트에서는 queryFn 주입으로 이 경로를 타지 않음)
async function loadSdkQuery(): Promise<QueryFn> {
  const mod = await import("@anthropic-ai/claude-agent-sdk");
  return (mod as { query: unknown }).query as QueryFn;
}
