# 开发提示词集（按波次投喂）

使用说明：按 P0 → P6 顺序，每个波次一条提示词投给执行 agent。每次投喂前确认上一波任务在 _index.tsv 中已全部 DONE、READY 已重算。单波次内 agent 依 _index.md 的 claim 协议执行（claim 前重读 tsv、状态同写任务块与索引、完成后写完成证据）。

---

## P0 红色契约（E00，四个红测可并行）

你在独立仓库 `D:\3.开发\Simple XiuXian` 工作（pnpm + turbo 结构，引擎包 packages/engine，纯函数确定性引擎）。

必读：`docs/design/2026-09-06-小程序简化版设计.md`（权威设计，全部数值以此为准）、`.markgate/backlogs/2026-09-06-简化版完整玩法与小程序/` 下的 `_index.md`（claim 协议与批次规则）、`_design-sources.md`、对应 epic 文件。

任务：按 claim 协议认领并完成 epic-00 的全部四个红测任务（T-E00-F01/F02/F03/F04-001）。红测要求：只写测试与金色期望值，不实现被测模块；导入不存在的模块使其稳定失败（三次连跑退出码均非 0）；数值锚点全部取自设计文档表格（境界/属性派生/状态/会战/事件概率），不从任何旧实现反抄 expected。

约束：引擎零 Node 依赖（测试文件可用 node:crypto 做对拍）；确定性（sha256 掷骰，禁 Math.random）；术语遵守「实力等级」（level 数值）与「境界等级」（阶段名）之分。完成每个任务后更新 _index.tsv 状态与任务块完成证据；四个任务全 DONE 后把 W1 两个任务（T-E01-F01-001、T-E02-F01-001）置 READY，然后停止等待下一条提示词。提交信息用中文 `test: 简化版 M2 红色契约（战斗/目录/NPC 会战/历练）`。

---

## P1 战斗引擎（E01，同 owner 三任务串行）

仓库与必读同 P0。

任务：认领 epic-01 三个任务并严格按批次串行完成：T-E01-F01-001（combat-profile 属性派生）→ T-E01-F02-001（battle 1v1 回合引擎）→ T-E01-F03-001（battle-status 状态效果）。实现全部数值公式以设计文档 §战斗系统 为唯一来源；掷骰走既有 `hash.ts` 的 sha256/deterministicRoll；纯函数、无 Math.random；每完成一个任务让对应红测转绿并跑全量引擎测试防回归。

约束：不改 M1 既有 39 项测试与境界/经济公式；战报逐回合记录为纯数据（UI 回放直接消费）；同输入双跑 deepEqual 必须断言。完成后重算 READY（W3 的 T-E03-F01-001 与 T-E02-F03-001 依赖本波），提交信息 `feat: 战斗引擎（属性派生/回合/状态）`，然后停止。

---

## P2 内容目录与生产（E02，F01→F02 可与 P1 波次交错）

仓库与必读同 P0。

任务：认领 epic-02 任务：T-E02-F01-001（catalog.ts 四表：功法 8/法术 12/装备 4×4/丹药 2 + 相性检索 + 上限校验）→ T-E02-F02-001（production.ts 丹房器坊点数生产）。数值逐字对齐设计文档 §功法目录/§法术目录/§装备系统/§丹药系统 四张表；GameSnapshot 扩展字段必须旧档兼容（缺字段默认值）。

完成后重算 READY，提交信息 `feat: 内容目录与丹房器坊生产`，停止。

---

## P3 管理命令与历练（E02-F03 + E03，波次见 _index）

仓库与必读同 P0。

任务：按 _index.tsv 的 READY 顺序完成：T-E02-F03-001（engine.ts 管理命令：learn_art/wear_gear/use_pill/appoint_elder + 岗位任命 + 月结增益接线）、T-E03-F01-001（expedition.ts 六事件历练结算，对手注入式）、T-E03-F02-001（settlement.ts 伤势模型与休养恢复，保持 9 步月结顺序）。历练的对手由 opponentProvider 注入，本波先用 fixture 弟子，不依赖 NPC 实装。

约束：settlement.ts 是批次 owner（E04-F04 排在其后）；所有命令返回新状态；纪事分类（normal/milestone/warning）按设计。完成后重算 READY（W4 的 T-E04-F01-001），提交信息 `feat: 管理命令、历练遭遇与伤势规则`，停止。

---

## P4 NPC 宗门与两宗对抗（E04）

仓库与必读同 P0。

任务：按依赖顺序完成 epic-04 四任务：T-E04-F01-001（rival.ts 生成与月度运行时，难度三档）→ T-E04-F02-001（宣战状态与相遇接线，opponentProvider 接真实 rival）→ T-E04-F03-001（sect-war.ts 3v3 会战）→ T-E04-F04-001（settlement.ts 胜负四结局与评级，把 settleSectWar 挂进月结第 7 步）。

约束：rival.ts 两任务同 owner 串行；settlement.ts 两任务同 owner（F04 在 E03-F02 之后）；确定性双跑断言（60 月两宗状态 deepEqual）必须通过；四结局（飞升/吞并/被吞并/凋敝）与甲乙丙丁评级阈值写死常量。完成后重算 READY（W6/W7），提交信息 `feat: NPC 宗门、宣战会战与胜负结局`，停止。

---

## P5 小程序 UI 纵切（E05，严格串行）

仓库与必读同 P0。UI 框架默认 Taro（React）；若实施中发现必须改原生 WXML，先回写设计文档 §工程方案 并在任务块记录，再继续。

任务：按序完成 epic-05：T-E05-F01-001（apps/miniapp Taro 骨架 + wx.setStorage 存档适配 round-trip + 自动推进定时器）→ T-E05-F02-001（首页/主界面/弟子殿核心纵切）→ T-E05-F03-001（丹房器坊/仓库/对手情报/纪事回放/结局页全量）→ T-E05-F04-001（微信开发者工具真机旅程验证 + 体积实测 + miniapp README）。

约束：引擎通过打包引入（验证零 Node 依赖）；快照 JSON <100KB；页面数据一律从 GameState 派生，不在 UI 复制公式；发现引擎 bug 回修时必须全量回归。完成后提交信息 `feat: 小程序 UI 纵切与真机验证`，停止。

---

## P6 调平与收口（E06）

仓库与必读同 P0。

任务：T-E06-F01-001（scripts/balance-sim.mjs 千局模拟：难度三档 ≥1000 局，对照锚点中位 30–60 游戏年通关/吞并被吞并各 ≤25%/等级差 ≤1，不达标只调常量表并把终值回写设计文档）→ T-E06-F02-001（设计文档状态/README/CHANGELOG 收口，主仓 `_map.md` 简化版条目改为已实施）→ T-E06-F03-001（提交 + 本地 tag v0.2.0）。

约束：T-E06-F03-001 的 push 部分授权为 REQUIRED——只做本地提交与 tag，push 等待用户明确指令。完成后 `pnpm validate` 退出 0 并停止，向用户报告调平结论与收口状态。
