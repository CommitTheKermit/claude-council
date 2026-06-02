import { describe, it, expect } from "vitest";
import { tallyVotes } from "../src/council/tally.js";
import type { VoteRules } from "../src/council/types.js";

const rules: VoteRules = {
  timeoutMs: 180_000,
  quorumRatio: 0.5, // 과반
  hostUserId: "host-1",
};

describe("tallyVotes", () => {
  it("정족수 충족 + 단독 최다득표 -> majority", () => {
    // 4명 중 3명 투표(과반), A 2표 B 1표
    const result = tallyVotes({
      votes: [
        { userId: "u1", choice: "A" },
        { userId: "u2", choice: "A" },
        { userId: "u3", choice: "B" },
      ],
      participantCount: 4,
      rules,
    });
    expect(result).toEqual({ choice: "A", outcome: "majority", contested: false });
  });

  it("정족수 충족 + 동점 -> 호스트 결정(host-tiebreak)", () => {
    // 4명 중 2명 투표(정확히 과반), A 1표 B 1표 동점
    const result = tallyVotes({
      votes: [
        { userId: "u1", choice: "A" },
        { userId: "u2", choice: "B" },
      ],
      participantCount: 4,
      rules,
      hostChoice: "B",
    });
    expect(result).toEqual({ choice: "B", outcome: "host-tiebreak", contested: true });
  });

  it("정족수 미달 -> 호스트 결정(host-quorum-fail)", () => {
    // 4명 중 1명만 투표(과반 미달)
    const result = tallyVotes({
      votes: [{ userId: "u1", choice: "A" }],
      participantCount: 4,
      rules,
      hostChoice: "A",
    });
    expect(result).toEqual({ choice: "A", outcome: "host-quorum-fail", contested: true });
  });

  it("타임아웃 + 무응답 -> 호스트 결정(host-timeout)", () => {
    const result = tallyVotes({
      votes: [],
      participantCount: 4,
      rules,
      timedOut: true,
      hostChoice: "C",
    });
    expect(result).toEqual({ choice: "C", outcome: "host-timeout", contested: true });
  });

  it("호스트 결정이 필요한데 hostChoice가 없으면 에러", () => {
    expect(() =>
      tallyVotes({ votes: [{ userId: "u1", choice: "A" }], participantCount: 4, rules }),
    ).toThrowError(/hostChoice/);
  });

  it("한 사람이 여러 번 투표하면 마지막 표만 인정", () => {
    // u1이 A->B로 변경, u2 B. 3명 중 2명(과반), B 2표
    const result = tallyVotes({
      votes: [
        { userId: "u1", choice: "A" },
        { userId: "u1", choice: "B" },
        { userId: "u2", choice: "B" },
      ],
      participantCount: 3,
      rules,
    });
    expect(result).toEqual({ choice: "B", outcome: "majority", contested: false });
  });
});
