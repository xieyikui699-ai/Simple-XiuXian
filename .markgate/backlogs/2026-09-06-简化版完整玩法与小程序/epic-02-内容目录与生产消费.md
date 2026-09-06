# E02 内容目录与生产消费

目录单一 owner（catalog.ts），生产单一 owner（production.ts），管理命令在 engine.ts 扩展。

### T-E02-F01-001 内容目录 catalog
- 状态：DONE
- 设计来源：D-005；D-006；D-007；D-008；D-009
- owner：新建于 packages/engine/src/catalog.ts
- 设计要点：四张表——TECHNIQUES（8 门功法：真元%/五维平加）、SPELLS（12 门法术：倍率/CD/状态/五行系）、GEAR_CATALOG（4 槽×4 档固定值）、PILLS（2 丹：点数/费用/周期/效果）；检索函数 getTechniqueById/getSpellById/getGear/getPillById；法术相性 spellAffinityMultiplier(spell, rootElements)（同元素 +15%）；装备战力输入接口（供 combat-profile 读取）；学习资格（藏经阁拥有集合）与上限校验辅助（功法 1 门/法术 2 门）；craftYieldPct 聚合。
- 关联文件：packages/engine/src/catalog.ts（新建）；packages/engine/src/index.ts
- 依赖：T-E00-F02-001
- 局限：不做生产推进（production.ts 职责）；不做命令（engine.ts 职责）。
- 通过标准：引擎测试退出 0；T-E00-F02-001 全表数值断言全绿。
- 并行安全：与 T-E01-F01-001 并行（不同 owner）。
- 风险档位：MEDIUM
- 验证画像：V2（引擎单测）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p2
- 完成证据：catalog.ts 四表逐字对齐设计文档 §功法目录/§法术目录/§装备系统/§丹药系统（8/12/4×4/2，含器坊点数 20/60/150/300、费用 200/600/1500/3000、限档 {1:2,2:3,3:4}）；检索/相性（同系 ×1.15）/学习资格与上限 1/2 辅助/gearCombatInput 装备战力接口/workshopCraftYieldPct 聚合（丹道→丹房、器道→器坊，不跨车间）。catalog.test.ts 追加全表数值断言；引擎切片 74/74 通过（M1 既有项不回归），tsc --noEmit 退出 0。注：E00-F02 红测四表断言内容随本任务一并落地转绿（P0 波次未先执行）。

### T-E02-F02-001 丹房与器坊生产 production
- 状态：DONE
- 设计来源：D-008；D-009
- owner：新建于 packages/engine/src/production.ts
- 设计要点：岗位模型（丹房/器坊各 1–2 岗，从无职成年内门弟子任命，不战斗不修炼）；点数推进（1 岗 +10 点/月，craftYieldPct 天赋 +20% 乘算）；开炉校验（灵石费用立即扣、点数不足拒绝）；出炉（点数达标 → 装备入仓库/丹药入仓库，纪事 normal）；器坊档位受宗门等级限制（1级→1-2/2级→1-3/3级→1-4）；GameSnapshot 扩展 jobs 字段（在炉任务/岗位分配/点数），旧档缺字段默认空。
- 关联文件：packages/engine/src/production.ts（新建）；packages/engine/src/state.ts
- 依赖：T-E02-F01-001
- 局限：不做岗位任命命令（E02-F03 职责）；不做服用/穿戴效果（对应命令职责）。
- 通过标准：引擎测试退出 0；点数/费用/限档/出炉/旧档兼容断言全绿；同 seed 双跑 deepEqual。
- 并行安全：与 T-E01-F02-001 并行（不同 owner）。
- 风险档位：MEDIUM
- 验证画像：V2（引擎单测）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p2
- 完成证据：production.ts 岗位模型（丹房/器坊各 ≤2 岗、无职成年内门、跨车间互斥、坐化自动离岗）；点数推进 1 岗 +10/月 ×(1+craftYieldPct)（丹道/器道 12/月）；开炉校验（灵石立即扣 insufficient_resource、点数池不足 craft_points_insufficient、限档 gear_tier_locked）；出炉（装备开炉即入仓库、丹药在炉周期到期入仓库，均纪事 normal）；advanceWorkshops 供月结第 4 步接线（本任务不接线，E02-F03 职责）。state.ts 扩展 jobs/warehouse/library 与弟子 techniqueId/spellIds/equippedGear（全部可选字段，旧档缺字段空值兼容 + jobsOf/warehouseOf 归一化，createGame 初始化空结构）。production.test.ts 覆盖点数/费用/限档/出炉/旧档兼容/同 seed 双跑 deepEqual 全绿；引擎切片 74/74 通过。口径备注：点数池模型——开炉一次性扣点数池+灵石（设计表未给装备在炉周期，故装备开炉即出炉；丹药周期 2/1 月与满 2 岗点数积累时长自洽）。

### T-E02-F03-001 管理命令扩展 engine
- 状态：DONE
- 设计来源：D-002；D-006；D-007；D-008；D-009
- owner：packages/engine/src/engine.ts
- 设计要点：新增管理命令（纯函数返回新状态）：learn_art（研读功法/法术，校验藏经阁拥有与上限 1/2）、wear_gear（穿戴/替换，旧装备回仓库）、use_pill（仓库服丹：延寿丹 maxLifespan +10、聚灵丹 12 月 ×1.5 真元 buff 不叠加刷新）、appoint_elder（资源/战备长老任命与替换，不战斗不修炼）+ promote 岗位任命（丹师/工匠）；月结接线：真元增益计入功法/聚灵丹 buff、突破率计入养气诀与战备长老、属性派生计入功法/装备、供奉计入资源长老；全部命令纪事 normal 一条。
- 关联文件：packages/engine/src/engine.ts；packages/engine/src/settlement.ts；packages/engine/src/combat-profile.ts（只读消费）
- 依赖：T-E02-F02-001,T-E01-F03-001
- 局限：不做历练掉落（E03 职责）；不改境界/经济公式。
- 通过标准：引擎测试退出 0；学习上限/装备替换回仓/丹药不叠加/长老唯一性与月结生效断言全绿；M1 既有测试不回归。
- 并行安全：W3 波次执行；与 E03-F01 并行（不同 owner）。
- 风险档位：MEDIUM
- 验证画像：V2（引擎单测）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p3
- 完成证据：engine.ts 新增管理命令（纯函数返回新状态、各落纪事 normal 一条）：learnArt（藏经阁拥有校验、功法限 1 门/法术限 2 门/重复拒绝/art_not_found）、wearGear（仓库按槽+档取件、旧装备卸下回仓、equippedGear 更新）、usePill（延寿丹 maxLifespan +10 写入、聚灵丹 spiritFocusUntilTurn = 当前回目+12 不叠加刷新、仓库耗尽拒绝）、appointElder（资源/战备长老各至多 1 名、同职替换旧长老自动卸任、与丹师/工匠岗位互斥 disciple_job_busy、无职成年内门限制；丹师/工匠任命复用 production.assignWorkshopJob/removeWorkshopJob）。月结接线（settlement.ts）：第①步资源长老供奉 ×1.2；第③步功法真元 %并入增幅池、功法/装备五维平加经 buildCombatProfile 聚合计入有效悟性、养气诀 +3 与战备长老 +3 并入突破率（currentSuccessRate 增加可选 extraFlat，M1 调用兼容）、聚灵丹持续期真元 ×1.5、岗位/长老占用者不修炼；第④步 advanceWorkshops 接入（旧档无 jobs 字段跳过，保持扩展字段缺省口径）；飞升当月跳过④⑤（advanceWorkshops 终局守卫不触发）。engine.test.ts 追加 8 项断言（学习上限矩阵/装备替换回仓/丹药不叠加与到期失效/长老唯一性与兼差拒绝/资源长老供奉 round(40×1.2)=48/战备长老突破 +3 边界 seed 扫描/功法月结公式）。引擎 136/136 通过（M1 既有项不回归）；我方文件 biome 0 错误。
