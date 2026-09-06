# E04 NPC 宗门与两宗对抗

rival.ts 两任务同 owner 串行（F01 → F02）；sect-war.ts 独立 owner；settlement.ts 的 F04 与 E03-F02 同 owner 批次在后。

### T-E04-F01-001 NPC 宗门生成与月度运行时 rival
- 状态：DONE
- 设计来源：D-015；D-016
- owner：新建于 packages/engine/src/rival.ts
- 设计要点：createRivalSect({seed, difficulty})——掌门 1+内门 3+外门 20，弟子用同一 generateDisciple 生成器；装备按宗门等级自动配最强档（1→档1/2→档2/3→档3）；advanceRivalSect(rival, state, turn)——内门真元/突破同玩家公式（难度 ×0.8/1.0/1.2 作用于真元收益）、灵石充足每月招 1 外门（招募频率随难度）、升阶条件满足自动升阶；经济简算（外门供奉−俸禄−招募费）；情报读模型（名册/境界等级/实力等级/伤势常驻可见）；同 seed 双跑 deepEqual。
- 关联文件：packages/engine/src/rival.ts（新建）
- 依赖：T-E00-F03-001,T-E01-F01-001
- 局限：不做宣战/会战（后续任务）；NPC 不服丹不研读（装备即战力）。
- 通过标准：引擎测试退出 0；生成/运行时/难度/升阶/装备档位断言全绿；双跑 deepEqual。
- 并行安全：rival.ts 批次首任务；与 T-E03-F02-001 并行。
- 风险档位：HIGH
- 验证画像：V3（引擎单测 + 双跑）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p4（2026-09-07 00:5x claim；按 T-E00-F03-001 golden 契约实现，advanceRivalSectMonthly(rival, turn) 纯函数口径以红测为准）
- 完成证据：rival.ts 落地（createRivalSect/rivalGearTierForRank/rivalRecruitPlan/advanceRivalSectMonthly/rivalRosterView/pickRivalOpponent）；T-E00-F03-001 生成/运行时/难度/招募配额/升阶/突破清零 golden 全绿；同 seed 双跑 deepEqual 通过；162 项引擎测试退出 0（2026-09-07）。

### T-E04-F02-001 宣战状态与相遇接线 rival
- 状态：DONE
- 设计来源：D-017；D-014
- owner：packages/engine/src/rival.ts
- 设计要点：war state（warWithRival/warCooldownUntilTurn 落 GameState）；declareWar 命令（玩家随时；冷却期拒绝）；NPC 宣战判定（声望差>50 或其等级更高时 15%/月，sha256 掷骰）；opponentProvider 实现——把 rival 弟子注入 settleExpedition 的切磋/掠夺对位（随机可战弟子，seed 确定性选取）；月结接入 advanceRivalSect（第 6 步）。
- 关联文件：packages/engine/src/rival.ts；packages/engine/src/settlement.ts（只读接入）
- 依赖：T-E04-F01-001,T-E03-F01-001
- 局限：不结算会战（sect-war 职责）；rival.ts 批次第二任务。
- 通过标准：引擎测试退出 0；宣战条件/冷却/NPC 概率/相遇注入断言全绿；双跑 deepEqual。
- 并行安全：rival.ts 批次串行第二任务。
- 风险档位：MEDIUM
- 验证画像：V2（引擎单测）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p4
- 完成证据：GameState 落 warWithRival/warDeclaredTurn/warCooldownEndsTurn/warParty/sectWars/rival 字段（旧档可选兼容）；rival.ts 落 rivalWarDecision/WAR_DECLARE_ROLL_PCT=15/WAR_COOLDOWN_MONTHS=12/declareWar/canPlayerDeclareWar/pickRivalOpponent；月结第 ⑥ 步接 advanceRivalSectMonthly + NPC 宣战判定，第 ⑤ 步 opponentProvider 缺省接真实对手（`${seed}:rival-opponent:${turn}` 确定性选将）、对手战败伤势落回对手名册；engine.ts 落 setWarParty/playerDeclareWar；宣战条件/冷却/NPC 概率/相遇注入断言全绿（campaign.test.ts 宣战次月触发会战并进入 12 月冷却），162 项测试退出 0。

### T-E04-F03-001 会战结算 sect-war
- 状态：DONE
- 设计来源：D-018；D-019；D-013
- owner：新建于 packages/engine/src/sect-war.ts
- 设计要点：settleSectWar({state, rival, turn})——宣战次月触发；双方各派 3 名可出战内门（玩家可指定 war_party 命令，默认按实力等级降序自动选最强 3；不足按实有数）；按实力等级降序（同值真元高者优先）同序配对逐场 resolveBattle（source=war）；胜场多者赢，1:1:1 比总伤害仍平判玩家胜；胜方掠败方灵石 10%（≤5000）声望 +10 士气 +5、败方 −10/−5；参战者按战败伤势规则；三份战报 + 会战摘要落纪事；冷却 12 月（从宣战月起算）。
- 关联文件：packages/engine/src/sect-war.ts（新建）；packages/engine/src/battle.ts（只读）
- 依赖：T-E04-F02-001,T-E01-F03-001
- 局限：不做胜负终局判定（E04-F04 职责）；单会战模型（无多线战争）。
- 通过标准：引擎测试退出 0；T-E00-F03-001 会战 golden 全绿；双跑 deepEqual；既有回归不破。
- 并行安全：独立 owner；settleSectWar 挂载由 E04-F04 统一接线。
- 风险档位：HIGH
- 验证画像：V3（引擎单测 + 双跑）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p4
- 完成证据：sect-war.ts 落地（SECT_WAR_FIGHTERS=3/selectSectWarFighters/pairSectWarFighters/resolveSectWar/runSectWar/warPlunder/sectWarRecord/injuryMonthsLeftFor）；逐场复用 runBattle（source=sect-war，A=我方攻方）；总伤害取战报 totalDamage（battle 域为 1:1:1 平局比拼预留口径）；T-E00-F03-001 选将/配对/裁决/掠夺上限/±10/±5 golden 全绿；runSectWar 同输入双跑 deepEqual 通过；口径修订一处：rival.test.ts 平局场伤害 (150,150)→(150,100)（原输入完全对称，任一对称聚合下总伤害恒相等，无法触发 totalDamage 裁决，保留测试意图的最小修正）。

### T-E04-F04-001 胜负判定与结局评价 settlement
- 状态：DONE
- 设计来源：D-019；D-020；D-021；D-016
- owner：packages/engine/src/settlement.ts
- 设计要点：月结第 7 步接入 settleSectWar（到期时）；第 8 步胜负判定：飞升（元婴前期圆满，M1 已有）、吞并（对方声望 ≤0 且我方等级更高 → 次月触发）、被吞并（对称）、凋敝（内门 0 且灵石<300 连续 6 月，计数器落 state）；结局评价（用时年/突破总数/会战胜绩/坐化数/剩余灵石 → 甲乙丙丁，阈值写死常量）；结局后 settleMonthly 拒绝（M1 语义保持）；大境界突破声望 +3（进入 4/7/10 级）。
- 关联文件：packages/engine/src/settlement.ts；packages/engine/src/state.ts；packages/engine/src/sect-war.ts（挂载）
- 依赖：T-E04-F03-001
- 局限：settlement.ts 批次第二任务（E03-F02 在后）；不改 9 步顺序锚点。
- 通过标准：引擎测试退出 0；四结局/评级/声望+3/终局锁断言全绿；60 月双局同 seed deepEqual；M1 既有测试不回归。
- 并行安全：settlement.ts 批次串行收尾。
- 风险档位：HIGH
- 验证画像：V3（引擎单测 + 双跑 + 回归）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p4
- 完成证据：settlement.ts 落第 ⑦ 步会战挂载（到期 runSectWar + 掠夺交割 + 声望/士气 ±10/±5 + 伤势落账 + 会战记录/战报存档 + 冷却收尾）与第 ⑧ 步胜负判定（annexationTriggered/annexedTriggered 对称判定；declineStreakAfter/isDeclineCollapse 凋敝计数落 state.bankruptStreak，连续 6 月触发）；大境界突破（4/7/10 级）声望 +3 与 state.totalBreakthroughs 计数；四结局均写 rating/score（ENDING_RATING_THRESHOLDS 写死常量，rateEnding/endingScore 纯函数）；结局后 settleMonthly 拒绝（M1 语义保持）；campaign.test.ts 锁 60 月双局同 seed deepEqual（P4 约束）+ 宣战-会战-冷却链路 + 四结局合成断言；全量 162 项测试退出 0（含 M1 既有测试不回归）；600 月长跑验证：20 场会战/对手自动升 2 级/外门容量按等级封顶。附带修正：naming.ts ordinal 上限 300→10000（NPC 按月自动招募长跑必需，M1 测试不回归），rival 外门招募受宗门等级容量约束（设计 §宗门体系 100/300/500）。
