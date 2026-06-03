# claude-council 프로젝트 메모리

Claude Code의 객관식 질문을 Discord 버튼 투표로 보내 팀 합의 답을 Claude가 받게 하는 협업 도구. 핵심 경로는 Claude가 명시적으로 호출하는 `council_vote` MCP stdio 도구.

## 문서 라우팅 (Document Routing)

작업 맥락에 따라 아래 문서를 참조할 것. 관련 주제가 나오면 해당 문서를 먼저 읽고 결정 이력을 따른다.

- 배포 모델 / Discord 봇 자격증명 주입 / 셋업 마법사 / 플러그인 포장: @docs/distribution-model.md
  - 요약: 현재 모델 A(팀마다 자기 봇 + 가이드 셋업 마법사) 채택, 모델 B(중앙 봇 호스팅)는 나중에 고려. 적용 순서는 MCP 코어 검증 -> 플러그인 포장 -> 셋업 마법사.
