# E03 历练与遭遇

expedition.ts 以"注入对手"为边界，先于 NPC 实装；rival 实装后由 E04-F02 接线真实对手。settlement.ts 伤势接线与 E04-F04 胜负同 owner，批次内串行。

### T-E03-F01-001 历练事件结算 expedition
- 状态：PENDING
- 设计来源：D-014；D-003；D-019
- owner：新建于 packages/engine/src/expedition.ts
- 设计要点：settleExpedition({seed, turn, state, battleRunner, opponentProvider})——宗门级月掷一次：收获 50%（灵石 50–150 ×(1+incomePct 天赋)）、切磋 15%（随机可出战内门弟子 vs 注入对手，走 resolveBattle source=expedition）、掠夺 10%（宣战状态 200–400 灵石；否则降级切磋）、奇遇 10%（功法书/法术书/装备档 1–2 随机其一）、危险 10%（出战弟子 30% 轻伤/15% 重伤）、丹药奇缘 5%；切磋奖惩声望 +2/−1 士气 +1/−1；掉落入藏经阁/仓库并纪事；返回 ExpeditionReport（事件/战报/掉落/伤势）供月结纪事与 UI。
- 关联文件：packages/engine/src/expedition.ts（新建）；packages/engine/src/battle.ts（只读）
- 依赖：T-E01-F02-001,T-E02-F01-001
- 局限：对手由 opponentProvider 注入（fixture 或 rival）；不接月结（E03-F02 职责）。
- 通过标准：引擎测试退出 0；T-E00-F04-001 六事件 golden 全绿；同 seed 双跑 deepEqual。
- 并行安全：与 T-E01-F03-001 依赖边隔开；与 E02-F03 并行。
- 风险档位：HIGH
- 验证画像：V3（引擎单测 + 确定性双跑）
- 授权边界：INLINE（仓库内实现）
- 执行者：-
- 完成证据：-

### T-E03-F02-001 月结历练接线与伤势恢复 settlement
- 状态：PENDING
- 设计来源：D-013；D-021
- owner：packages/engine/src/settlement.ts
- 设计要点：月结第 5 步接入 settleExpedition（方针=历练时），报告落宗门纪事（战斗条目带战报引用）；伤势模型落 Disciple（injuryUntilTurn），禁战判定供会战/切磋选人；休养方针全体伤势恢复 −2 月；月结顺序保持 9 步锚点（生产在历练前、年度衰老最后）；旧档缺 injury 字段兼容为无伤。
- 关联文件：packages/engine/src/settlement.ts；packages/engine/src/state.ts
- 依赖：T-E03-F01-001
- 局限：settlement.ts 批次首任务（E04-F04 同 owner 在后）；不改经济/突破公式。
- 通过标准：引擎测试退出 0；历练月纪事/伤势禁战/休养 −2/顺序锚点断言全绿；M1 既有 39 项测试不回归。
- 并行安全：settlement.ts 批次串行；与 T-E04-F01-001 并行。
- 风险档位：MEDIUM
- 验证画像：V2（引擎单测）
- 授权边界：INLINE（仓库内实现）
- 执行者：-
- 完成证据：-
