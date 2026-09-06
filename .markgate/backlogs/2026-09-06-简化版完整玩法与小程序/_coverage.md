# 简化版完整玩法与小程序覆盖矩阵

记录标识：2026-09-06-简化版完整玩法与小程序

| D-id | 任务类型 | 任务 id | owner | 说明 |
|---|---|---|---|---|
| D-001 | 既有实现/回归 | T-E00-F03-001；T-E06-F02-001 | packages/engine/src/realms.ts；settlement.ts | M1 已落地，红测与收口回归锁定 |
| D-002 | 测试/实现/接线 | T-E00-F02-001；T-E02-F03-001 | packages/engine/src/catalog.ts；engine.ts | 升阶条件回归 + 长老任命命令 |
| D-003 | 既有实现/接线 | T-E03-F01-001；T-E06-F01-001 | packages/engine/src/expedition.ts；scripts/balance-sim.mjs | incomePct 天赋接入历练收益；调平观察经济曲线 |
| D-004 | 既有实现/测试 | T-E00-F01-001；T-E01-F01-001 | packages/engine/src/battle.test.ts；combat-profile.ts | 灵根/五维作为战斗输入 |
| D-005 | 测试/实现 | T-E00-F02-001；T-E02-F01-001 | packages/engine/src/catalog.ts | M2 新旋钮真实消费 |
| D-006 | 测试/实现/接线 | T-E00-F02-001；T-E02-F01-001；T-E02-F03-001；T-E03-F01-001 | catalog.ts；engine.ts；expedition.ts | 功法表、限 1 门、藏经阁、功法书掉落 |
| D-007 | 测试/实现/接线 | T-E00-F01-001；T-E00-F02-001；T-E02-F01-001；T-E02-F03-001 | battle.test.ts；catalog.ts；engine.ts | 法术表、限 2 门、五行相性 +15% |
| D-008 | 测试/实现/接线 | T-E00-F02-001；T-E02-F01-001；T-E02-F02-001；T-E02-F03-001；T-E03-F01-001 | catalog.ts；production.ts；engine.ts；expedition.ts | 装备表、器坊炼制、穿戴、掉落 |
| D-009 | 测试/实现/接线 | T-E00-F02-001；T-E02-F01-001；T-E02-F02-001；T-E02-F03-001 | catalog.ts；production.ts；engine.ts | 丹药表、丹房生产、服丹效果 |
| D-010 | 测试/实现 | T-E00-F01-001；T-E01-F01-001；T-E04-F01-001 | combat-profile.ts；rival.ts | 派生公式唯一 owner，玩家与 NPC 共用 |
| D-011 | 测试/实现/接线 | T-E00-F01-001；T-E01-F02-001；T-E03-F01-001；T-E04-F03-001 | battle.ts；expedition.ts；sect-war.ts | 回合引擎、CD、伤害、命中暴击、平局 |
| D-012 | 测试/实现 | T-E00-F01-001；T-E01-F03-001 | battle-status.ts | 五类状态 + 抗性 |
| D-013 | 测试/实现/接线 | T-E00-F01-001；T-E01-F02-001；T-E03-F01-001；T-E03-F02-001；T-E04-F03-001 | battle.ts；expedition.ts；settlement.ts | 战败伤势、禁战、休养恢复 |
| D-014 | 测试/实现/接线 | T-E00-F04-001；T-E03-F01-001；T-E04-F02-001 | expedition.ts；rival.ts | 六事件表、概率、掉落、对手注入 |
| D-015 | 测试/实现 | T-E00-F03-001；T-E04-F01-001 | rival.ts | NPC 生成与装备按等级 |
| D-016 | 测试/实现/接线 | T-E00-F03-001；T-E04-F01-001；T-E04-F04-001 | rival.ts；settlement.ts | NPC 月度运行时、难度三档 |
| D-017 | 测试/实现/接线 | T-E00-F03-001；T-E04-F02-001 | rival.ts | 宣战条件、战争状态、冷却 |
| D-018 | 测试/实现/接线 | T-E00-F03-001；T-E04-F03-001 | sect-war.ts | 3v3 配对、奖惩、冷却 |
| D-019 | 测试/实现/接线 | T-E00-F03-001；T-E03-F01-001；T-E04-F04-001 | rival.ts；expedition.ts；settlement.ts | 声望来源聚合与吞并判定输入 |
| D-020 | 测试/实现/接线 | T-E00-F03-001；T-E04-F04-001；T-E05-F03-001 | settlement.ts；apps/miniapp | 胜负四结局与评级、结局页 |
| D-021 | 测试/实现/回归 | T-E00-F04-001；T-E03-F02-001；T-E04-F04-001；T-E06-F01-001 | settlement.ts；scripts/balance-sim.mjs | 月结 9 步顺序保持 |
| D-022 | 实现/验证 | T-E05-F01-001；T-E05-F04-001 | apps/miniapp | Taro 骨架、wx 存档 round-trip、真机 |
| D-023 | 实现/验证 | T-E05-F02-001；T-E05-F03-001；T-E05-F04-001 | apps/miniapp | 8 页面纵切与真机旅程 |
| D-024 | 验证/文档 | T-E06-F01-001；T-E06-F02-001 | scripts/balance-sim.mjs；docs/ | 千局模拟与锚点回写 |
