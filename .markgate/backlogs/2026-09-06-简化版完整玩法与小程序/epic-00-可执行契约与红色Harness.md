# E00 可执行契约与红色 Harness

四个红测 owner 相互独立，可并行；全部收红后 E01/E02 才能进入实现波次。数值锚点一律取自权威设计表格，不得反抄旧实现输出。

### T-E00-F01-001 锁定战斗系统 golden 红测
- 状态：DONE
- 设计来源：D-004；D-007；D-010；D-011；D-012；D-013
- owner：新建于 packages/engine/src/battle.test.ts
- 设计要点：属性派生锚点（等级 1/体魄 50 → 生命 350；力量 50+武器档 1 → 物攻 110；魂力 50+法宝档 1 → 法威 108；防御 ⌊体魄×1.5+护甲⌋；先攻=身法）；回合规则（先攻定序同值攻方先、普攻 1.0×、法术 CD、伤害 max(1, round(攻×倍率−防×0.8))、命中 90%、暴击 5+天赋≤50 且 1.5×、30 回合平局无伤势）；状态效果（灼烧 6%/8% 最大生命 3/2 回合、冰冻 1 回合、减速先攻 −5 3 回合、护盾吸收、反伤 10%、抗性按概率抵消、同状态不叠加异源取最强）；伤势（战败 40% 轻伤 1 月/20% 重伤 3 月）；五行相性同灵根 +15%。全部断言先于实现写死为金色值。
- 关联文件：packages/engine/src/battle.test.ts（新建）
- 依赖：无
- 局限：只建立红色 Harness，不实现模块；导入的符号以设计命位（combat-profile/battle/battle-status）为准。
- 通过标准：pnpm --filter @simple-xiuxian/engine test 预期非 0（红证据），首个失败为 battle 模块导出缺失；三次连跑退出码均非 0 且稳定。
- 并行安全：独占该测试文件；可与 E00 其余红测并行。
- 风险档位：LOW
- 验证画像：V1（红证据 + git diff --check）
- 授权边界：INLINE（仓库内测试）
- 执行者：zcode-p0
- 完成证据：battle.test.ts 锁定 §状态效果 全部数值（灼烧 6%/8%×350 生命=21/28 每回合、3/2 回合消退；冰冻 1 回合；减速 −5×3 回合；护盾 20%/12% 容量与吸收拆分；反伤 10%；抗性 roll<20 抵消；attachStatus 同状态不叠加异源刷新取最强）。属性派生/回合规则/伤势/相性 golden 由并行实现方 zcode-p1 在 combat.test.ts 先行锁定（combat-profile.ts/battle.ts 已落地），为避免双契约本文件聚焦其未覆盖的 battle-status.ts；该模块尚未实现，导入即 TS2307。红证据：pnpm --filter @simple-xiuxian/engine test 三次连跑 exit=2/2/2，失败首因 TS2307 battle-status.js；biome check 通过；git diff --check 干净。

### T-E00-F02-001 锁定内容目录与生产数值红测
- 状态：DONE
- 设计来源：D-002；D-005；D-006；D-007；D-008；D-009
- owner：新建于 packages/engine/src/catalog.test.ts
- 设计要点：功法 8 门全表数值与限 1 门；法术 12 门全表（倍率/CD/状态/五行系）与限 2 门、同灵根 +15% 检索函数；装备 4 槽 4 档表与器坊点数 20/60/150/300、费用 200/600/1500/3000、宗门等级限档映射；丹药 2 种（点数/费用/周期/效果）与聚灵丹不叠加刷新；生产速率（1 岗 +10 点/月、craftYieldPct 天赋 +20%）；升阶条件表回归（既有 sectUpgradeFailureReason 不回归）。先写死期望值表。
- 关联文件：packages/engine/src/catalog.test.ts（新建）
- 依赖：无
- 局限：不实现目录模块；不测 UI。
- 通过标准：引擎测试预期非 0（红证据），失败命中 catalog 模块缺失；三次连跑稳定。
- 并行安全：独占该测试文件。
- 风险档位：LOW
- 验证画像：V1（红证据）
- 授权边界：INLINE（仓库内测试）
- 执行者：zcode-p0（并行协作：zcode-p2 先行写入功法 8/法术 12/装备 4×4/丹药 2 全表 golden、相性 +15%、限 1/限 2、检索与 craftYieldPct 聚合，数值经 zcode-p0 逐项复核与设计文档一致；生产速率锚点由 zcode-p2 的 production.test.ts 锁定）
- 完成证据：catalog.test.ts 全表数值与设计文档逐字对齐（zcode-p2）+ zcode-p0 补齐「升阶条件表回归」（sectUpgradeFailureReason：1→2 筑基+5000、2→3 金丹×3+30000、3 级封顶七种口径）。catalog.ts 已由 zcode-p2 实现转绿，升阶回归编译通过；同套件红证据由 rival/expedition/battle-status 缺失模块承担，pnpm test 三次连跑 exit=2/2/2。

### T-E00-F03-001 锁定 NPC 宗门与会战胜负 golden 红测
- 状态：DONE
- 设计来源：D-015；D-016；D-017；D-018；D-019；D-020
- owner：新建于 packages/engine/src/rival.test.ts
- 设计要点：NPC 生成（掌门 1+内门 3+外门 20、同一生成器、装备按等级配档 1）；月度运行时（真元/突破同公式、招 1 外门、自动升阶、难度 ×0.8/1.0/1.2 作用于真元与招募频率）；宣战条件（玩家随时、NPC 声望差>50 或等级更高时 15%/月、冷却 12 月）；会战（各 3 名按实力等级降序同序配对、胜场多者赢、1:1:1 比总伤害仍平判玩家胜、胜方掠 10% 灵石≤5000 声望+10 士气+5、败方 −10/−5）；声望表（历练+1/切磋+2−1/突破大境界+3/下限 0 无消退）；胜负四结局（飞升/吞并/被吞并/凋敝连续 6 月）与评级五维输入。同 seed 双跑 deepEqual 断言。
- 关联文件：packages/engine/src/rival.test.ts（新建）
- 依赖：无
- 局限：战斗细节引用 T-E00-F01-001 的 golden，不在此重复断言；不实现模块。
- 通过标准：引擎测试预期非 0（红证据），失败命中 rival/sect-war 模块缺失；三次连跑稳定。
- 并行安全：独占该测试文件。
- 风险档位：LOW
- 验证画像：V1（红证据）
- 授权边界：INLINE（仓库内测试）
- 执行者：zcode-p0
- 完成证据：rival.test.ts 锁定：NPC 生成（掌门1+内门3+外门20=24 人、同 seed 双跑 deepEqual、1 级 2000 石/士气 70/声望 50）、装备按等级配档 1/2/3；月度运行时（真元=玩家同公式 monthlyZhenyuanGain×难度 round、招募 1.0/1.2 首月 1 名付 300 石、0.8 首月不招、小数配额进位表、自动升阶 1→2 耗 5000、突破后真元清零）；宣战（条件声望差>50 或等级更高时 roll<15、冷却 12 月常量）；声望表（切磋+2/−1/平0、会战±10、大境界 4/7/10 +3、下限 0）；会战（selectSectWarFighters 排除伤势外门取最强 3、降序同序配对、胜场多者赢/1:1:1 比总伤害/仍平玩家胜、掠夺 floor(min(5000,10%))、±10/±5、runSectWar 同 seed 双跑 deepEqual）；四结局判定与凋敝 6 月连续计数、评级五维输入形状（甲乙丙丁阈值设计未给数值，留给 E04-F04 定夺并回写）。红证据：TS2307 rival.js/sect-war.js + TS2305 settlement 结局导出；三次连跑 exit=2/2/2。

### T-E00-F04-001 锁定历练遭遇与月结顺序红测
- 状态：DONE
- 设计来源：D-014；D-013；D-021
- owner：新建于 packages/engine/src/expedition.test.ts
- 设计要点：六事件表概率分布（50/15/10/10/10/5，掠夺非宣战降级切磋）与区间值（灵石 50–150×(1+incomePct)、掠夺 200–400）；掉落物（功法书/法术书/装备档 1–2/随机丹药）；危险伤势分支（30% 轻伤/15% 重伤）；切磋奖惩（声望 +2/−1、士气 +1/−1）；战斗回调注入式接口（对手弟子由调用方传入）；月结 9 步顺序锚点（生产在历练前、NPC 在会战前、年度衰老最后）。golden 以固定 seed 写死事件序列。
- 关联文件：packages/engine/src/expedition.test.ts（新建）
- 依赖：无
- 局限：不实现模块；不依赖真实 NPC（注入 fixture 弟子）。
- 通过标准：引擎测试预期非 0（红证据），失败命中 expedition 模块缺失；三次连跑稳定。
- 并行安全：独占该测试文件。
- 风险档位：LOW
- 验证画像：V1（红证据）
- 授权边界：INLINE（仓库内测试）
- 执行者：zcode-p0
- 完成证据：expedition.test.ts 锁定：六事件区间 [0,50)/[50,65)/[65,75)/[75,85)/[85,95)/[95,100) 边界 golden；伤势分支 [0,30) 轻伤/[30,45) 重伤/其余安全；事件掷骰契约格式 `${seed}:expedition:${turn}`，固定 seed 期望序列由 node:crypto sha256 预计算写死（expedition-golden 1–12 月、expedition-golden-2 含奇遇/丹药月）；收获 50–150 与 incomePct 0.15 加成区间 [57,173]；掠夺仅宣战（同 seed 战/和双跑对比：非宣战永不出现掠夺、且必降级切磋并带 degradedFrom 标记，胜方 200–400）；切磋奖惩 ±2/±1 与 battle.winner 配平；奇遇奖励形状（功法书/法术书/装备档 1–2）与丹药（p-yanshou/p-juling）；opponentProvider/fighterProvider 注入式接口与调用计数；同输入双跑 deepEqual；MONTHLY_STEP_ORDER 九步常量（生产在历练前、NPC 在会战前、衰老最后）。红证据：TS2307 expedition.js + TS2305 MONTHLY_STEP_ORDER；三次连跑 exit=2/2/2。
