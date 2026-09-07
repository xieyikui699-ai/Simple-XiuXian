# apps/miniapp —《掌门，不好了》简化版小程序壳

Taro（React + TypeScript + webpack5）微信小程序。UI 数据一律从 `@simple-xiuxian/engine` 的
`GameState` 派生（引擎导出的常量表与派生函数），UI 层不复制任何游戏公式。

## 目录

```
apps/miniapp/
├── config/               # Taro 构建配置（webpack5、weapp）
├── src/
│   ├── app.ts / app.config.ts / app.css
│   ├── store/
│   │   ├── save-adapter.ts   # 存档适配（纯层，注入 SaveBackend，可单测）
│   │   ├── game-store.ts     # 会话仓库（引擎命令包装 + 自动存档）
│   │   ├── use-game.ts       # React 绑定 + wx.setStorage 后端 + 自动推进 hook
│   │   └── game-store.test.ts
│   ├── ui/display.ts     # 年月/数字/境界着色等展示派生
│   └── pages/            # index 首页 / main 主界面 / disciples 弟子殿 /
│                         # disciple-detail 详情 / alchemy 丹房器坊 / warehouse 仓库 /
│                         # rival 对手宗门 / chronicle 纪事 / ending 结局
├── project.config.json   # DevTools 导入配置（appid 用测试号 touristappid）
└── tsconfig.json         # 继承仓库根 tsconfig.base.json
```

## 命令

```
pnpm install                     # 仓库根执行（pnpm workspace）
pnpm --filter @simple-xiuxian/miniapp build:h5      # Web/H5 产物 dist-web（开发与验证基座）
pnpm --filter @simple-xiuxian/miniapp dev:h5        # H5 watch 模式
node scripts/web-serve.mjs 4173                     # 伺服 dist-web（仓库根）
pnpm --filter @simple-xiuxian/miniapp build:weapp   # weapp 产物 dist/（DevTools 导入目标）
pnpm --filter @simple-xiuxian/miniapp test          # esbuild 打包单测 + node --test
```

引擎为 workspace 依赖，webpack 打包时从 `packages/engine` 的 ESM 产物引入。
已验证：产物（dist/）无任何 `node:` 内建引用；构建全量体积约 390 KB（主包上限 2MB）。

## 存档规格（设计 D-022）

- `wx.setStorageSync` key：`simple-xiuxian-save-1..3`（手动 3 格）+ `simple-xiuxian-save-4`（自动 1 格）；
  当前局指针 `simple-xiuxian-current-slot`。
- 每格内容：`{ version: 1, slot, savedAt, difficulty, state: GameState }` JSON。
- round-trip：写读 `deepEqual` 已入单测；损坏/缺失读取返回 null 不崩溃。
- 会话内任何推进/命令都会写自动格；手动格保存的是保存时刻的快照，读档复制开局。
- 自动推进：主界面开关，1 秒 1 月调 `settleMonthly`，终局自动停摆。

单测内还固化了体积断言：120 月推进后快照 JSON < 100KB。

## 微信开发者工具运行

1. 微信开发者工具 → 导入项目 → 目录选 `apps/miniapp`（识别 project.config.json，miniprogramRoot=dist/）。
2. appid 使用测试号（project.config.json 已填 `touristappid`；如有正式测试号可替换）。
3. 先执行 `pnpm --filter @simple-xiuxian/miniapp build:weapp` 再导入；开发时可开着 `dev:weapp` watch。
4. 关闭「ES6 转 ES5」（产物已编译，配置 es6:false）。

## 旅程验证记录（E05-F04，2026-09-07 于 Web/H5 浏览器完成）

完整旅程已在 H5（Chromium，390×844 视口）通过：开局（宗门名/种子/难度三档）→ 推进至第1年7月（月结弹层/突破成败/历练六事件：寻石 154、切磋、遇险、奇遇武器档2）→ 弟子殿/详情（装备档2 穿戴至司徒鸳、提拔冷灿入内门 4/10）→ 丹房器坊（任命丹师、开炉校验「点数不足」）→ 仓库三卡片使用 → 对手宗门（天魔教名册 30 人/宣战 → 会战三阵全负被掠 219 灵石 → 冷却 12 月）→ 纪事战报逐回合回放（历练 1 场 + 会战 3 场，含会心/未命中）→ 自动格跨进程读档 + 手动格1 存读一致（快照 43,844 字节 <100KB）。weapp 构建同步通过；微信真机验证保留为可选项。

1. 开局：首页输入宗门名/种子/难度 → 开新局。
2. 推进 12 月（可开自动推进）；查看月结弹层（灵石/突破/坐化摘要）。
3. 弟子殿 → 弟子详情（五维/灵根/天赋/修炼视图）→ 一次提拔。
4. 外出历练方针下推进数月 → 纪事页查看历练/切磋条目（若有战斗，点开「战报回放」逐回合查看）。
5. 对手宗门页：查看名册情报/声望/等级 → 满足条件时点击「宣战」→ 来月会战 → 会战记录三份战报回放。
6. 丹房器坊页：任命丹师/工匠 → 攒点数开炉（聚灵丹/延寿丹/装备）→ 出炉入仓库。
7. 仓库页：装备「穿戴」、丹药「服用」、藏经阁「研读」→ 弟子详情确认生效。
8. 手动存档 → 杀进程 → 重进读档继续，确认状态一致。
9. （可临时调参）触发任意结局 → 结局页显示四结局文案 + 甲/乙/丙/丁评级与得分。
10. 全程截图/录屏留证；记录快照体积与 120 月自动推进耗时。

## 体积与性能实测记录

- weapp 构建产物（2026-09-06）：总计 390,293 字节；taro.js 133,110 / app.js 96,459 / common.js（含引擎）38,392 / vendors.js 16,427。
- 快照体积：120 月推进后 16,319 字节（上限 102,400），弟子 23 人、纪事 127 条。
- 120 月推进（node 环境）耗时毫秒级，自动推进 1 秒 1 月无压力。

## 当前边界（依赖引擎波次）

| 功能 | 状态 | 依赖 |
| --- | --- | --- |
| 开局/概况/推进/方针/自动推进/对方等级 | ✅ 可用 | M1 引擎 |
| 弟子殿名册/详情/提拔/招募/升阶 | ✅ 可用 | M1 引擎 |
| 纪事列表（分色）+ 战报逐回合回放 | ✅ 可用 | E01/E03/E04 |
| 结局页（四结局 + 甲乙丙丁评级） | ✅ 可用 | E04-F04 |
| 研读/穿戴/服丹/长老任命（弟子详情） | ✅ 可用 | E02-F03 管理命令 |
| 丹房器坊（岗位/开炉/在炉）+ 仓库三卡片 | ✅ 可用 | E02 catalog/production |
| 对手宗门（名册/宣战/冷却/会战记录） | ✅ 可用 | E04 rival/sect-war |
| 旅程验证（Web/H5 浏览器） | ✅ 完成 | Chromium 390×844 |
| 微信真机验证 | ⏳ 可选项 | 微信开发者工具/真机 |

## 体验版打包说明

1. `pnpm --filter @simple-xiuxian/miniapp build:weapp`（生产构建，NODE_ENV=production 由 CLI 自动设置）。
2. DevTools 上传时填入版本号与备注（如 `v0.1.0 E05 纵切`）；上传体积以 DevTools「代码依赖分析」为准。
3. 上传后在小程序管理后台将版本设为体验版，添加体验成员即可真机验证。
