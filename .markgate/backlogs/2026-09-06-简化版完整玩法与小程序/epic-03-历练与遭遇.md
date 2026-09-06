# E03 历练与遭遇

expedition.ts 以"注入对手"为边界，先于 NPC 实装；rival 实装后由 E04-F02 接线真实对手。settlement.ts 伤势接线与 E04-F04 胜负同 owner，批次内串行。

### T-E03-F01-001 历练事件结算 expedition
- 状态：DONE
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
- 执行者：zcode-p3
- 完成证据：expedition.ts 六事件宗门级月掷 deterministicRoll(`${seed}:expedition:${turn}`)，区间 50/15/10/10/10/5 与 p0 固定 seed golden 序列 A/B 对拍全绿。收获 50–150×(1+incomePct)（月结按天赋聚合传入）；切磋/掠夺走 runBattle(source=expedition)，对手 opponentProvider、出战弟子 fighterProvider 注入（本波 fixture 弟子，不依赖 NPC 实装）；掠夺非宣战降级切磋（degradedFrom 标记）；奇遇功法书/法术书/装备档 1–2（书入藏经阁去重、装备入仓库）；危险 30% 轻伤/15% 重伤（injuryForRoll 纯映射）；丹药奇缘随机一炉入仓库。切磋胜声望 +2 士气 +1、败 −1/−1、平 0/0；战败方伤势掷骰随战报携带。报告 ExpeditionReport 纯函数不改状态（事件/战报/掉落/伤势/notes），同 seed 双跑 deepEqual（p0 断言）；combatReadyDisciples 禁战选将（内门、无岗位/长老占用、无未愈伤势）。修正红测两处并注明：丹药 id 以已落地 catalog.ts 为准（p-yanshou→pill-yanshou）；序列 B golden 原稿在 atWar:false 下断言原始 plunder，与同文件「非宣战降级」断言自相矛盾，改该测试入参为 atWar:true（golden 序列未动，D-014 降级口径不变）。p0 六事件 golden 全部转绿。

### T-E03-F02-001 月结历练接线与伤势恢复 settlement
- 状态：DONE
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
- 执行者：zcode-p3
- 完成证据：settlement.ts 重排为 9 步顺序锚点并导出 MONTHLY_STEP_ORDER（economy→policy→breakthrough→production→expedition→rival→sectWar→verdict→aging，p0 顺序 golden 全绿；⑥⑦⑧ 为 E04-F02/F04 留接线点注释）。第⑤步接入 settleExpedition（方针=外出历练且非资源危机月），报告落账：灵石/声望/士气并入 SettlementResult 增量、notes 按 normal/warning 落纪事、掉落入藏经阁（去重）与仓库、战报入 state.battles（最新在前、上限 30）、result.expedition 携带报告。伤势模型落 Disciple.injury（untilTurn = 当月 + 禁战月数；expedition 报告 heavy → 状态 severe 映射）+ combatReadyDisciples 禁战判定供切磋/会战选人；休养方针全体伤势恢复 −2（不超过当月，次月起可出战）；坐化长老自动卸任；旧档缺 injury/elders 字段兼容为无伤/无长老。expedition.test.ts 追加月结接线块 8 项：收获月报告落账与灵石核对、incomePct 天赋接线（福缘深厚 ×1.15）、切磋战报入库与声望/士气合成（方针 +1/−2 为基）、危险伤势落账与 warning 纪事、伤势禁战选将排除、休养 −2 精确断言、奇遇/丹药掉落接线、危机月不触发遭遇。M1 既有项不回归（外出历练一处断言按 D-014 六事件表更新并在测试名注明：seed slice-seed-1 第 2 月为「危险-安全」，方针声望 +1/士气 −2 保持）。引擎 136/136 通过；确定性由同 seed 双跑 deepEqual 覆盖。
