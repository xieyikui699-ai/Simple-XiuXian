# E05 小程序 UI 纵切

四任务严格串行（骨架 → 核心页 → 全页 → 真机），owner 统一为 apps/miniapp。UI 框架默认 Taro（React）；如实施时改选原生 WXML，先回写设计文档 §工程方案 再继续。

### T-E05-F01-001 小程序骨架与存档适配
- 状态：DONE
- 设计来源：D-022
- owner：新建于 apps/miniapp/
- 设计要点：Taro(React) 工程初始化（tsconfig 继承本仓 base、esbuild/webpack 打包引入 @simple-xiuxian/engine 源码或 dist，确认零 Node 依赖通过）；存档适配层 useGameStore——wx.setStorageSync key simple-xiuxian-save-1..4（手动 3+自动 1），GameState JSON round-trip（写读 deepEqual）、当前局指针；自动推进定时器 hook（1 秒 1 月调 settleMonthly，可暂停）；页面路由骨架与导航栏。
- 关联文件：apps/miniapp/（新建）
- 依赖：T-E04-F04-001
- 局限：不做具体页面内容（后续任务）；不做真机验证（E05-F04 职责）。
- 通过标准：miniapp build 退出 0；存档 round-trip 单测绿；引擎在打包产物中可调用（冒烟：创建游戏→推进 3 月）。
- 并行安全：E05 批次首任务。
- 风险档位：MEDIUM
- 验证画像：V2（构建 + 单测）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p5
- 完成证据：Taro 4.2.1(React+TS+webpack5) 骨架落地，`pnpm --filter @simple-xiuxian/miniapp build:weapp` 退出 0；save-adapter/game-store 单测 11 项全绿（round-trip deepEqual、指针、损坏容错、创建→推进 3 月冒烟、120 月快照 <100KB 断言）；dist 打包探针确认引擎进包（common.js 含引擎字符串、全产物无 node: 内建引用）。注：依赖 T-E04-F04-001 未 DONE，依用户 P5 指令先行；实施仅消费 M1 已有引擎导出，未触碰引擎。

### T-E05-F02-001 核心页面纵切
- 状态：DONE
- 设计来源：D-023；D-022
- owner：apps/miniapp/src/pages/
- 设计要点：首页（新的开始：宗门名/种子/难度三选；继续征程：存档列表进入）；主界面（概况栏：回合/年月/灵石/士气/声望/我方与对方宗门等级；推进一月按钮与月结结果弹层：灵石变化/突破/事件/坐化摘要；自动推进开关）；弟子殿（内/外门分列名册、境界等级着色、弟子详情：五维/灵根/天赋/功法法术/装备/伤势/修炼视图、提拔按钮）；管理操作入口（研读/穿戴/服丹/长老任命，调 engine 命令后写存档）。
- 关联文件：apps/miniapp/src/pages/
- 依赖：T-E05-F01-001
- 局限：丹房器坊/仓库/对手/纪事/结局页后续；不追求视觉打磨。
- 通过标准：构建退出 0；「开局→概况→推进 12 月→弟子详情→一次提拔」页面旅程可用；状态刷新与存档一致。
- 并行安全：E05 批次串行第二任务。
- 风险档位：MEDIUM
- 验证画像：V2（构建 + 旅程自测）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p5
- 完成证据：首页（新开局三要素+难度三选+存档列表/删除/继续上局）、主界面（概况栏+方针四选+推进一月+月结弹层+自动推进开关+升阶+手动存档 1–3 格）、弟子殿（内外门分列+境界着色+招募三选一）、弟子详情（五维基础→有效/灵根/天赋/修炼视图/提拔）全部落地；构建退出 0、typecheck/biome 绿、store 层单测覆盖「创建→推进→提拔→存读档」旅程等价序列。概况栏「对方宗门等级」与研读/穿戴/服丹/长老任命按引擎现状显示为未实装占位（等 E02-F03/E04）。页面级渲染旅程待 DevTools/真机复核（E05-F04 显式职责）。

### T-E05-F03-001 全页面与战斗回放
- 状态：DONE
- 设计来源：D-023；D-020
- owner：apps/miniapp/src/pages/
- 设计要点：丹房/器坊页（岗位分配、开炉、在炉进度、出炉收取）；仓库页（装备/丹药/功法书法术书三类卡片 + 使用入口）；对手宗门情报页（名册/境界/伤势/等级/声望、宣战按钮与冷却提示、会战记录）；纪事页（里程碑/警告/战斗分色，战斗条目点开逐回合回放）；结局页（四结局文案 + 甲乙丙丁评级 + 开新局）。
- 关联文件：apps/miniapp/src/pages/
- 依赖：T-E05-F02-001
- 局限：不做真机验证；战斗回放只读战报不重复结算。
- 通过标准：构建退出 0；全部 8 页面可达且数据同源；一场会战三份战报可回放；结局页评级正确显示。
- 并行安全：E05 批次串行第三任务。
- 风险档位：MEDIUM
- 验证画像：V2（构建 + 旅程自测）
- 授权边界：INLINE（仓库内实现）
- 执行者：zcode-p5
- 完成证据（部分）：纪事页（三色分列，最新在前）与结局页（飞升结局文案+仙途总览+开新局入口）已落地可用；构建/typecheck/biome 绿。丹房器坊/仓库/对手情报页已建路由与说明占位（目录与生产核心 E02-F01/F02 已被并行波次合入，页面接入待 E02-F03 管理命令；对手/会战依赖 E04）；战斗条目分色回放、吞并/凋敝结局与甲乙丙丁评级待对应引擎波次合入后补全。**未满足项**：一场会战三份战报回放、结局评级正确显示（阻塞于 E01/E04 波次，非 UI 侧问题）。
- 验收补记（zcode-p6，2026-09-07）：E04 波次已全部合入后复查，丹房器坊/仓库/对手情报四页仍为占位路由（35–48 行级别，未引用 assignWorkshopJob/startPillCraft/wearGear/usePill/declareWar，纪事页未消费 `state.battles` 回放）；`pnpm --filter @simple-xiuxian/miniapp build/typecheck/test` 全绿。页面接线余量如实留待后续波次。
- 完成补记（zcode-p6，2026-09-07 补收口）：四页全部接通引擎——store 新增 assignJob/removeJob/craftPill/craftGear/study/wear/takePill/appointElder/wageWar 九个命令 action 与 18 条错误文案；丹房器坊页（岗位任命/卸任、丹炉两丹开炉与在炉剩余月、器坊槽位×档位选择并受 maxForgeTierForRank 限档）；仓库页（装备/丹药/藏经阁三卡片 + 选人使用入口）；对手宗门页（rivalRosterView 名册含伤势禁战、宣战按钮 + 冷却提示、会战记录含三阵对阵）；纪事页新增「战报回放」（state.battles 逐回合展开，状态注记与终局生命）；弟子详情页接研读/穿戴/服丹/长老任命与伤势/聚灵丹 buff 展示；主界面补对方宗门等级、结局页接 rating/score。新增共享 DisciplePicker。store 单测 14 项全绿（新增岗位开炉/宣战会战三战报回放/研读服丹长老 round-trip 断言）；weapp 构建成功、biome/typecheck/validate 全绿。真机旅程留证仍属 E05-F04（待用户）。

### T-E05-F04-001 真机验证与体验版准备
- 状态：DONE
- 设计来源：D-022；D-023
- owner：apps/miniapp/
- 设计要点：微信开发者工具导入运行（appid 用测试号）；真机旅程：开局 → 推进 12 月（含一次历练与一次宣战会战）→ 存档 → 杀进程 → 读档继续 → 结局触发（可临时调参验证）；性能检查（120 月推进耗时、快照体积 <100KB 确认）；体验版打包说明写入 apps/miniapp/README.md；发现的问题按严重度回修引擎或 UI。
- 关联文件：apps/miniapp/；apps/miniapp/README.md（新建）
- 依赖：T-E05-F03-001
- 局限：不含上传发布（平台操作由用户执行）；修引擎 bug 须回归全量测试。
- 通过标准：真机旅程全部通过留证（截图/录屏路径记录）；快照体积实测记录；`pnpm validate` 退出 0。
- 并行安全：E05 批次收尾。
- 风险档位：MEDIUM
- 验证画像：V3（真机 + 全量回归）
- 授权边界：INLINE（仓库内实现与本地工具链）
- 执行者：zcode-p5
- 完成证据（部分）：apps/miniapp/README.md 已写入：DevTools 导入步骤（touristappid 测试号）、真机旅程清单、体验版打包说明、体积实测（weapp 产物 390,293 字节；120 月快照 16,319 字节 < 100KB 上限，弟子 23/纪事 127）。`pnpm --filter @simple-xiuxian/miniapp typecheck/test/build` 全绿。**未满足项**：本机未安装微信开发者工具，且 DevTools 登录/真机扫码需用户本人操作——DevTools 导入运行与真机旅程留证待用户执行；`pnpm validate` 全仓绿受并行 P1/P2 波次在途改动影响（E00 红测已收口、E01 实现中），全量回归以各波次收口后为准。
- 验收补记（zcode-p6，2026-09-07）：自动可验部分已完成——`pnpm validate` 全仓退出 0（引擎 164 + store 11）；快照体积回归已回修（`state.battles` 字节预算 45KB/30 条，120 月快照 75,835 字节 < 102,400 上限）；README 打包说明已具备。DevTools 导入与真机旅程留证仍待用户执行。
- 补记（zcode-p6，2026-09-07）：E05-F03 四页接线完成后复跑 `pnpm validate` 退出 0（store 单测 14 项）；apps/miniapp/README.md 真机旅程清单扩至 10 步（含历练/宣战会战/回放/丹房器坊/仓库使用/结局评级），等用户按清单留证。
- 完成补记（zcode-p6，2026-09-07，验证方式变更）：用户决策「以 web 栈开发为基座」——新增 Taro H5 构建（`build:h5`/`dev:h5` → `dist-web`）与 `scripts/web-serve.mjs` 伺服脚本，存档走 localStorage 与 wx.setStorage 同构；随路修复开局难度未传引擎的接线缺口（`rivalDifficulty` 现按 easy/normal/hard → ×0.8/1.0/1.2 落库）。浏览器（Chromium 390×844）完整旅程验证通过：开局 → 推进至第1年7月（月结弹层/突破成败/历练六事件齐发）→ 弟子提拔（冷灿 4/10）→ 武器档2 穿戴司徒鸳 → 丹房任命丹师 + 开炉校验 → 仓库三卡片使用 → 对手宗门宣战 → 会战三阵战报逐回合回放 → 自动格跨进程读档 + 手动格存读一致（快照 43,844 字节）。weapp 双构建通过、`pnpm validate` 退出 0。微信真机验证降级为可选项；境界中文名与会战来源标签两处显示瑕疵随路修复。
