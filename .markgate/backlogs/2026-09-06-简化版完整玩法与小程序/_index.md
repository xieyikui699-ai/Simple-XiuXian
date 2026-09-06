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

当前 in-flight claim：T-E01-F01/F02/F03-001（zcode-p1）IN_PROGRESS。T-E00 四项红测已由 zcode-p0 全部 DONE；T-E02-F01/F02-001 已由 zcode-p2 完成（DONE）。其余 PENDING。E02-F01/F02 与 P1 波次交错执行（用户授权）。

## 最近检查点

- 2026-09-06：backlog 建立；权威设计补全定稿（功法/法术/装备/丹药/战斗/历练/NPC/会战/UI/调平全表数值）；M1 既有实现登记为回归锚点；W0 四项红测初始 READY，尚未执行。
- 2026-09-06（P2 波次，zcode-p2）：T-E02-F01-001、T-E02-F02-001 完成。catalog.ts 四表（功法 8/法术 12/装备 4×4/丹药 2）逐字对齐设计文档并随 catalog.test.ts 落地 E00-F02 四表断言；production.ts 岗位/点数/开炉/出炉落地，state.ts 扩展 jobs/warehouse/library 全部旧档兼容。引擎切片 74/74 通过（M1 不回归）、tsc --noEmit 0、biome 我方文件 0 错误。READY 重算：无新 READY（T-E02-F03-001 待 T-E01-F03-001、T-E03-F01-001 待 T-E01-F02-001，均由 P1 波次解锁）。注：E00 红测与 E01 实现仍在飞，全仓 `pnpm -r test` 整体转绿以 P1 收口为准。
- 2026-09-06（P0 红色契约，zcode-p0）：T-E00-F01/F02/F03/F04-001 全部 DONE。battle.test.ts 锁定状态效果契约（battle-status.ts 未实现 → 红）；catalog.test.ts 复核 zcode-p2 四表 golden 并补升阶条件回归；rival.test.ts 锁定 NPC 生成/月度运行时/宣战/声望/会战/四结局契约；expedition.test.ts 锁定六事件区间、固定 seed 事件序列（node:crypto 预计算）、降级规则、伤势分支与月结 9 步顺序常量。红证据：`pnpm --filter @simple-xiuxian/engine test` 三次连跑 exit=2/2/2，失败精确命中 TS2307（battle-status/expedition/rival/sect-war.js）与 TS2305（settlement 结局导出/MONTHLY_STEP_ORDER）；biome 0 错误。与并行实现方（zcode-p1 combat-profile/battle）API 冲突已协调：属性派生/回合规则 golden 由 combat.test.ts 承担，battle.test.ts 聚焦状态效果。READY 重算：W1 两任务（T-E01-F01-001、T-E02-F01-001）依赖已全部 DONE，两者在索引中均已为 READY（后者已由 zcode-p2 收口）。
