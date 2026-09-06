# E01 战斗引擎

三任务同 owner 严格串行（F01 → F02 → F03），共同 owner 为 packages/engine 战斗域。全部确定性：无 Math.random，掷骰走 sha256。

### T-E01-F01-001 战斗属性派生 combat-profile
- 状态：PENDING
- 设计来源：D-010；D-004
- owner：新建于 packages/engine/src/combat-profile.ts
- 设计要点：buildCombatProfile(disciple)——唯一公式 owner：生命=100+体魄×5+(实力等级−1)×50、物攻=力量×2+武器、法威=魂力×2+法宝、防御=⌊体魄×1.5+护甲⌋、先攻=身法+天赋先攻+减速修正；有效五维经既有 effectiveAttributes（天赋+功法+装备平加聚合）；返回分来源明细（基础/天赋/功法/装备）供 UI tooltip；玩家与 NPC 共用，不做弟子 clamp 例外。
- 关联文件：packages/engine/src/combat-profile.ts（新建）；packages/engine/src/talents.ts（只读）
- 依赖：T-E00-F01-001
- 局限：不含回合流程与状态；装备输入为已穿戴实例（穿戴命令由 E02-F03 提供）。
- 通过标准：pnpm --filter @simple-xiuxian/engine test 退出 0；T-E00-F01-001 中属性派生断言全绿；同输入双跑 deepEqual。
- 并行安全：battle 域批次串行首任务。
- 风险档位：MEDIUM
- 验证画像：V2（引擎单测）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p1（2026-09-06 claim，批次串行 F01→F02→F03）
- 完成证据：-

### T-E01-F02-001 1v1 回合引擎 battle
- 状态：PENDING
- 设计来源：D-011；D-013
- owner：新建于 packages/engine/src/battle.ts
- 设计要点：resolveBattle({seed, attacker, defender, turn, source})——先攻定序（同值攻方先）；每回合行动选择：确定性策略（可用法术按倍率从高到低、CD 未好则普攻；双方同策略）；伤害=max(1, round(攻击×倍率−防御×0.8))；命中 90%（sha256 掷骰）；暴击 5+天赋 critFlat（≤50）1.5×；战报逐回合记录（行动/伤害/状态/剩余生命）；先手致死即止；30 回合未分胜负判平（双方无伤势）；战败方 40% 轻伤/20% 重伤掷骰；source 标记（expedition/ambush-war 等）。
- 关联文件：packages/engine/src/battle.ts（新建）
- 依赖：T-E01-F01-001
- 局限：状态附加效果由 T-E01-F03-001 实现后接入（本任务先留 status 管道）；不做 UI 回放渲染。
- 通过标准：引擎测试退出 0；T-E00-F01-001 回合/伤害/命中/暴击/平局/伤势断言全绿；battle 引入后 M1 既有 39 项测试不回归。
- 并行安全：battle 域批次串行第二任务。
- 风险档位：HIGH
- 验证画像：V2（引擎单测 + 既有回归）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p1（2026-09-06 claim，批次串行 F01→F02→F03）
- 完成证据：-

### T-E01-F03-001 状态效果系统 battle-status
- 状态：PENDING
- 设计来源：D-012
- owner：新建于 packages/engine/src/battle-status.ts
- 设计要点：五类状态（灼烧 6%/8% 最大生命 3/2 回合、冰冻 1 回合、减速先攻 −5 3 回合、护盾吸收直至破除、反伤受击 10%）；同状态不叠加、异源刷新取最强（倍率/时长字典序）；抗性 statusResistPct 按概率抵消附加（sha256 掷骰）；接入 resolveBattle 行动前结算（冰冻跳行动）与回合末结算（灼烧扣血可致死，毒不可致死语义不引入——灼烧可致死）；战报 statusNote 标注。
- 关联文件：packages/engine/src/battle-status.ts（新建）；packages/engine/src/battle.ts
- 依赖：T-E01-F02-001
- 局限：不改属性派生公式；不新增第二套掷骰机制。
- 通过标准：引擎测试退出 0；T-E00-F01-001 状态断言全绿；同输入双跑 deepEqual；既有回归不破。
- 并行安全：battle 域批次串行第三任务。
- 风险档位：HIGH
- 验证画像：V2（引擎单测 + 确定性双跑）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p1（2026-09-06 claim，批次串行 F01→F02→F03）
- 完成证据：-
