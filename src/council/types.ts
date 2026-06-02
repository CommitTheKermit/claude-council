// Claude의 AskUserQuestion 한 건(객관식)을 표현
export interface CouncilQuestion {
  question: string;
  header: string;
  options: { label: string; description?: string }[];
}

// 한 참여자의 한 표
export interface Vote {
  userId: string;
  // 선택한 option label
  choice: string;
}

// 투표 규칙
export interface VoteRules {
  // 타임아웃(ms)
  timeoutMs: number;
  // 정족수 비율 (0~1). 투표 수 / 전체 참여자 수 가 이 값 이상이어야 유효
  quorumRatio: number;
  // 호스트(최종 결정권자) userId
  hostUserId: string;
}

// 집계 결과가 어떻게 도출됐는지
export type TallyOutcome =
  | "majority" // 정족수 충족 + 단독 최다 득표
  | "host-tiebreak" // 동점 -> 호스트 결정
  | "host-quorum-fail" // 정족수 미달 -> 호스트 결정
  | "host-timeout"; // 타임아웃 무응답 -> 호스트 결정

export interface TallyResult {
  // Claude에 주입할 최종 선택 label
  choice: string;
  outcome: TallyOutcome;
  // 의견이 갈렸는지(호스트 개입 여부)
  contested: boolean;
}
