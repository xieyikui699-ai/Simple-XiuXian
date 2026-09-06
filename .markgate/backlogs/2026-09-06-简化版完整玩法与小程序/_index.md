# 简化版完整玩法与小程序 backlog 索引

记录标识：2026-09-06-简化版完整玩法与小程序

## 层级树

- E00 可执行契约：战斗 golden 红测、内容目录红测、NPC/会战/胜负 golden 红测、历练遭遇 golden 红测。
- E01 战斗引擎：combat-profile 属性派生 → battle 回合引擎 → battle-status 状态效果（同 owner 批次串行）。
- E02 内容目录与生产消费：catalog 统一目录 → production 丹房器坊 → engine 管理命令扩展。
- E03 历练与遭遇：expedition 事件结算（对手注入式）→ settlement 伤势恢复接线。
- E04 NPC 宗门与两宗对抗：rival 生成与运行时 → 宣战与相遇接线 → sect-war 会战 → settlement 胜负结局。
- E05 小程序 UI 纵切：骨架与存档适配 → 核心页面 → 全页面与回放 → 真机验证（严格串行）。
- E06 收口与调平：balance-sim 千局调平 → 文档收口 → 本地打 tag。

## 统计

- L3 leaf：23 个。
- 初始 READY：4 个（E00 四组红色 Harness）。
- 机械统计：LOW 6、MEDIUM 11、HIGH 6；V1 4、V2 13、V3 6。
- 授权：INLINE 22、REQUIRED 1（T-E06-F03-001 涉及 push，需用户指令）。

## Next 规则

1. 只从 _index.tsv 中选择 status=PENDING 且 ready=READY 的任务。
2. claim 前重读 _index.tsv；同一次写入把任务改为 IN_PROGRESS，并在任务块「执行者」与索引 assignee 填同一稳定标识。
3. 完成一个波次后，只有依赖全部 DONE 的 PENDING 任务才能改为 READY；已 BLOCKED/CANCELLED 的依赖不得被当作完成。
4. 若数值口径（属性派生/状态/会战奖惩/事件概率）偏离权威设计，先暂停当前批次、修订设计/D-id/覆盖矩阵，再重算 READY。
5. 红测先行：E00 全部红测收口后才能进入实现波次；golden 不从旧实现反抄。

批次规则：battle 三任务（T-E01-F01 → T-E01-F02 → T-E01-F03）同 owner 串行；settlement.ts 两任务（T-E03-F02 → T-E04-F04）同 owner 串行；E05 四任务严格串行；rival.ts 两任务（T-E04-F01 → T-E04-F02）同 owner 串行。

## 依赖波次

- W0：T-E00-F01-001、T-E00-F02-001、T-E00-F03-001、T-E00-F04-001（初始全部 READY，可并行）。
- W1：T-E01-F01-001（依赖 E00-F01）∥ T-E02-F01-001（依赖 E00-F02）。
- W2：T-E01-F02-001（依赖 E01-F01）∥ T-E02-F02-001（依赖 E02-F01）。
- W3：T-E01-F03-001（依赖 E01-F02）∥ T-E03-F01-001（依赖 E01-F02 + E02-F01）∥ T-E02-F03-001（依赖 E02-F02 + E01-F03）。
- W4：T-E04-F01-001（依赖 E00-F03 + E01-F01）∥ T-E03-F02-001（依赖 E03-F01）。
- W5：T-E04-F02-001（依赖 E04-F01 + E03-F01）→ T-E04-F03-001（依赖 E04-F02 + E01-F03）。
- W6：T-E04-F04-001（依赖 E04-F03）∥ T-E06-F01-001（依赖 E04-F04 之后启动模拟引擎部分可提前至 E04-F03 完成）。
- W7：T-E05-F01-001（依赖 E04-F04）→ T-E05-F02-001 → T-E05-F03-001 → T-E05-F04-001（严格串行）。
- W8：T-E06-F02-001（依赖 E05-F04 + E06-F01）→ T-E06-F03-001（授权 REQUIRED）。

整体完成条件：全部任务 DONE/CANCELLED，D-001～D-024 双向覆盖无缺口；战斗/NPC/会战/历练确定性双跑 deepEqual 证据；千局模拟锚点达标或调平记录；`pnpm validate` 通过；真机旅程通过。

授权等待清单：T-E06-F03-001（git push / 打远端 tag）需用户明确指令；其余任务均为仓库内本地工作（INLINE）。

## 执行者与 claim

当前 in-flight claim：T-E04-F01-001（zcode-p4）、T-E05-F03/F04-001（zcode-p5）。T-E00 四项红测（zcode-p0）、T-E01 三项战斗引擎（zcode-p1）、T-E02-F01/F02（zcode-p2）、T-E02-F03-001 与 T-E03-F01/F02-001（zcode-p3）、T-E05-F01/F02（zcode-p5）均已 DONE。E02-F01/F02 与 P1 波次交错执行、E05-F01/F02 提前执行均经用户授权。

## 最近检查点

- 2026-09-06：backlog 建立；权威设计补全定稿（功法/法术/装备/丹药/战斗/历练/NPC/会战/UI/调平全表数值）；M1 既有实现登记为回归锚点；W0 四项红测初始 READY，尚未执行。
- 2026-09-07：E00 红色契约收口（战斗/目录/NPC 会战/历练四组 golden 转绿）；E01 战斗引擎、E02 目录与生产、E02-F03 管理命令、E03 历练与伤势接线全波次 DONE（zcode-p0/p1/p2/p3）；E04 四任务 DONE（zcode-p4）：rival 生成与运行时（难度三档）、宣战与相遇接线、sect-war 3v3 会战、settlement 四结局与甲乙丙丁评级挂月结第 7/8 步；60 月两宗双跑 deepEqual 通过；全量 162 项引擎测试退出 0。READY 重算：T-E06-F01-001 置 READY（W6）；T-E05-F01-001 已由 zcode-p5 先行 DONE。口径修订记录：rival.test 会战平局场伤害 (150,150)→(150,100)（对称输入无法触发 totalDamage 裁决）；expedition.test 丹药 id 对齐 catalog 目录（p3 收绿时修正）；naming.ts ordinal 上限 300→10000（NPC 自动招募长跑必需）。
- 2026-09-06（P2 波次，zcode-p2）：T-E02-F01-001、T-E02-F02-001 完成。catalog.ts 四表（功法 8/法术 12/装备 4×4/丹药 2）逐字对齐设计文档并随 catalog.test.ts 落地 E00-F02 四表断言；production.ts 岗位/点数/开炉/出炉落地，state.ts 扩展 jobs/warehouse/library 全部旧档兼容。引擎切片 74/74 通过（M1 不回归）、tsc --noEmit 0、biome 我方文件 0 错误。READY 重算：无新 READY（T-E02-F03-001 待 T-E01-F03-001、T-E03-F01-001 待 T-E01-F02-001，均由 P1 波次解锁）。注：E00 红测与 E01 实现仍在飞，全仓 `pnpm -r test` 整体转绿以 P1 收口为准。
- 2026-09-06（P0 红色契约，zcode-p0）：T-E00-F01/F02/F03/F04-001 全部 DONE。battle.test.ts 锁定状态效果契约（battle-status.ts 未实现 → 红）；catalog.test.ts 复核 zcode-p2 四表 golden 并补升阶条件回归；rival.test.ts 锁定 NPC 生成/月度运行时/宣战/声望/会战/四结局契约；expedition.test.ts 锁定六事件区间、固定 seed 事件序列（node:crypto 预计算）、降级规则、伤势分支与月结 9 步顺序常量。红证据：`pnpm --filter @simple-xiuxian/engine test` 三次连跑 exit=2/2/2，失败精确命中 TS2307（battle-status/expedition/rival/sect-war.js）与 TS2305（settlement 结局导出/MONTHLY_STEP_ORDER）；biome 0 错误。与并行实现方（zcode-p1 combat-profile/battle）API 冲突已协调：属性派生/回合规则 golden 由 combat.test.ts 承担，battle.test.ts 聚焦状态效果。READY 重算：W1 两任务（T-E01-F01-001、T-E02-F01-001）依赖已全部 DONE，两者在索引中均已为 READY（后者已由 zcode-p2 收口）。
- 2026-09-06（P1 战斗引擎，zcode-p1）：T-E01-F01/F02/F03-001 全部 DONE。combat-profile.ts（deriveCombatProfile 唯一公式 + buildCombatProfile 弟子适配层，分来源明细供 tooltip）；battle.ts（runBattle + epic 命名位 resolveBattle 对象签名入口：先攻定序同值攻方先、plan 行动脚本 CD 回落普攻、伤害 max(1, round(攻×倍率−防×0.8)) 暴击对取整后基础伤害 ×1.5、命中 90、30 回合平局、战败 40/20 伤势掷骰、扁平战报 actions 供 UI 回放）；battle-status.ts（五类状态纯逻辑 + runBattle 接入：灼烧回合末直接扣血可致死、冰冻次回合跳行动、减速 −5×3 回合、护盾吸收直至破除、反伤 10%、抗性按概率抵消，全部 sha256 掷骰，状态附加当回合不结算、次回合起生效）。与 zcode-p0 协调落地：属性派生/回合规则 golden 由 combat.test.ts 承担、battle.test.ts 聚焦状态效果（字段口径 hpPctPerTurn/turnsLeft、attachStatus）。验证：battle.test.js + combat.test.js 32/32 通过（含双跑 deepEqual、200 场命中率/暴击率统计、40 场抗性统计）；我方文件 biome 0 错误；index.ts 导出接线待与 zcode-p3 的 expedition 导出同批提交（避免踩其在途文件）。M1 engine.test 2 处失败（外出历练/飞升）归属 zcode-p3 对 settlement.ts 的在途伤势接线，非本波引入。READY 重算：T-E04-F01-001（依赖 T-E00-F03-001 + T-E01-F01-001）→ READY；T-E03-F01-001 / T-E02-F03-001 依赖本波部分虽已满足，但仍待 zcode-p3 在途的 T-E02/E03 链路收口（其已在 IN_PROGRESS）。
- 2026-09-07（P3 管理命令与历练，zcode-p3）：T-E02-F03-001、T-E03-F01-001、T-E03-F02-001 全部 DONE。expedition.ts 六事件宗门级月掷（deterministicRoll(`${seed}:expedition:${turn}`)，50/15/10/10/10/5 与 p0 固定 seed golden 序列 A/B 对拍全绿；opponentProvider/fighterProvider 注入式，本波 fixture 弟子不依赖 NPC 实装；掠夺非宣战降级切磋 degradedFrom；奇遇书入藏经阁去重/装备档 1–2 与丹药奇缘入仓库；切磋胜 +2/+1 败 −1/−1 平 0）；engine.ts 管理命令 learnArt/wearGear/usePill/appointElder（学习上限 1/2 与藏经阁校验、装备替换回仓、聚灵丹 12 月 ×1.5 不叠加刷新、长老唯一可替换且与丹师/工匠岗位互斥；丹师/工匠任命复用 production 命令）；settlement.ts 重排 9 步锚点并导出 MONTHLY_STEP_ORDER（⑥⑦⑧ 留 E04 接线点注释），第④步接 advanceWorkshops（旧档无 jobs 跳过保持缺省口径）、第⑤步接 settleExpedition（报告落账：灵石/声望/士气增量、纪事 normal+warning、掉落、战报入 state.battles 上限 30、result.expedition），伤势模型落 Disciple.injury（untilTurn 禁战判定 + combatReadyDisciples 选将）与休养恢复 −2、资源长老供奉 ×1.2、战备长老突破 +3、功法真元 %/五维有效值、聚灵丹 ×1.5 全部月结生效，飞升当月跳过④⑤，坐化长老自动卸任，旧档缺 injury/elders 字段兼容。修正 p0 红测两处（epic 内注明）：丹药 id 对齐已落地 catalog.ts（p-yanshou→pill-yanshou）；序列 B golden 原稿在 atWar:false 断言原始 plunder 与同文件降级断言自相矛盾，改该测试入参 atWar:true（golden 序列未动）。P1 移交的两处 M1 失败已收口：外出历练断言按 D-014 六事件表更新（测试名注明 seed slice-seed-1 第 2 月为「危险-安全」）；飞升当月跳过④⑤修复 advanceWorkshops 终局守卫误触。index.ts 追加 expedition 导出（与 p1 的战斗导出同批提交，按其检查点约定）。验证：引擎 136/136 通过（rival.test.js 按协议保持红至 P4 收绿）、我方文件 biome 0 错误、同 seed 双跑 deepEqual 断言在测。READY 重算：T-E04-F02-001 依赖 T-E04-F01-001（zcode-p4 在途）+ T-E03-F01-001（DONE），待 P4 首任务收口后置 READY；其余无新 READY（T-E06-F01-001 仍待 T-E04-F04-001）。
