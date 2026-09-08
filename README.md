# Simple XiuXian（《掌门，不好了》小程序简化版）

纯单机文字修仙经营游戏，微信小程序目标平台。独立于主仓（`D:\3.开发\XiuXian`）的产品线。

权威设计：`docs/design/2026-09-06-小程序简化版设计.md`。

## 玩法

两宗对抗的月结经营修仙：玩家经营自己宗门（招募直入内门/功法法术/丹药/装备/长老/丹房器坊；外门弟子只是数字，恒按等级上限满员、可分岗做工），NPC 对手宗门同帧推进（难度三档 ×0.8/1.0/1.2）。境界 10 段（练气→元婴前期），元婴前期为境界尽头（圆满止步）；压制对手——对方声望 ≤0 且我方宗门等级更高——实现吞并获胜。历练六事件、宣战会战 3v3、伤势坐化、三结局（吞并/被吞并/凋敝）与甲乙丙丁评级。

## 结构

- `packages/engine`：确定性规则引擎（纯 TypeScript，无 Node 依赖，sha256 自实现掷骰，可打包进小程序）。含战斗引擎、内容目录（功法 8/法术 12/装备 4×4/丹药 2）、丹房器坊生产、历练遭遇、NPC 宗门与会战、胜负结局评级。
- `apps/miniapp`：Taro（React）小程序壳。存档 `wx.setStorage` 4 格（手动 3 + 自动 1），1 秒 1 月自动推进。
- `scripts/balance-sim.mjs`：千局调平模拟（三难度批量跑，锚点判定，报告见 `scripts/balance-report.json`）。

## 命令

```
pnpm install
pnpm validate   # lint + typecheck + test（引擎 163 项 + miniapp store 14 项）
pnpm build      # 引擎 tsc 构建
node scripts/balance-sim.mjs          # 千局调平模拟（默认 400 局/难度档）
```

Windows 一键入口：双击根目录 `一键入口.bat`，菜单式脚本（1 诊断并修复运行环境 / 2 启动浏览器版 H5 / 3 启动微信开发者工具版 / 4 拉取最新版本 / 5 提交并推送 origin main / 6 构建发布包）。注意：该文件为 GBK + CRLF 编码，勿转存为 UTF-8（cmd 解析 UTF-8 批处理会随机错位）。

小程序构建与导入：

```
pnpm --filter @simple-xiuxian/miniapp build:weapp   # 产物在 apps/miniapp/dist
pnpm --filter @simple-xiuxian/miniapp dev:weapp     # watch 模式
```

Web（H5）本地运行（开发与验证基座，9:16 竖屏手机舞台：桌面居中手机画幅、手机竖屏全屏）：

```
pnpm --filter @simple-xiuxian/miniapp build:h5   # 产物在 apps/miniapp/dist-web
node scripts/web-serve.mjs 4173                  # http://localhost:4173
```

微信开发者工具导入 `apps/miniapp`（weapp 产物，测试号 touristappid），详见 `apps/miniapp/README.md`。

## 里程碑

1. M1 引擎月结闭环 ✅
2. M2 战斗引擎 + 内容目录 + 生产消费 + 历练遭遇 ✅
3. M3 NPC 对手宗门 + 宣战会战 + 胜负结局评级 ✅
4. M4 小程序 UI 纵切 ✅（八页面全接通；完整旅程已在 Web/H5 浏览器验证通过）
5. M5 千局调平 ✅（方针移除后重跑：中位 32–33 游戏年通关，锚点全过）+ 文档收口 ✅

## 数值调平结论

> 2026-09-08：飞升结局已移除（胜负收敛为吞并单一），下述「飞升通关中位」锚点为历史口径，保留作调平过程记录；后续调平以吞并/被吞并率、等级差、会战均值为准。

调平只改引擎常量表（`ZHENYUAN_BASE` 10→130、悟性系数 0.1→0.5），公式不动。月度方针机制移除后重跑 1200 局（三难度档 ×400）：飞升通关中位 32.1–33.1 游戏年（锚点 30–60 ✅）、吞并 0% / 被吞并 ≤0.75%（锚点 ≤25% ✅）、两宗等级差 ≤1 占比 0.88–0.93（锚点"多数时间" ✅）；常量表无需重调。详见 `docs/design/2026-09-06-小程序简化版设计.md` §数值调平 与 `scripts/balance-report.json`。
