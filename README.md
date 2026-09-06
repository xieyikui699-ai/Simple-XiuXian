# Simple XiuXian（《掌门，不好了》小程序简化版）

纯单机文字修仙经营游戏，微信小程序目标平台。独立于主仓（`D:\3.开发\XiuXian`）的产品线。

权威设计：`docs/design/2026-09-06-小程序简化版设计.md`。

## 玩法

两宗对抗的月结经营修仙：玩家经营自己宗门（招募/提拔/功法法术/丹药/装备/长老/丹房器坊），NPC 对手宗门同帧推进（难度三档 ×0.8/1.0/1.2）。境界 10 段（练气→元婴前期），任一弟子元婴前期圆满突破即飞升获胜；也可压制对手声望实现吞并。历练六事件、宣战会战 3v3、伤势坐化、四结局与甲乙丙丁评级。

## 结构

- `packages/engine`：确定性规则引擎（纯 TypeScript，无 Node 依赖，sha256 自实现掷骰，可打包进小程序）。含战斗引擎、内容目录（功法 8/法术 12/装备 4×4/丹药 2）、丹房器坊生产、历练遭遇、NPC 宗门与会战、胜负结局评级。
- `apps/miniapp`：Taro（React）小程序壳。存档 `wx.setStorage` 4 格（手动 3 + 自动 1），1 秒 1 月自动推进。
- `scripts/balance-sim.mjs`：千局调平模拟（三难度批量跑，锚点判定，报告见 `scripts/balance-report.json`）。

## 命令

```
pnpm install
pnpm validate   # lint + typecheck + test（引擎 164 项 + miniapp store 11 项）
pnpm build      # 引擎 tsc 构建
node scripts/balance-sim.mjs          # 千局调平模拟（默认 400 局/难度档）
```

小程序构建与导入：

```
pnpm --filter @simple-xiuxian/miniapp build:weapp   # 产物在 apps/miniapp/dist
pnpm --filter @simple-xiuxian/miniapp dev:weapp     # watch 模式
```

微信开发者工具导入 `apps/miniapp`（测试号 touristappid 即可运行），详见 `apps/miniapp/README.md`。

## 里程碑

1. M1 引擎月结闭环 ✅
2. M2 战斗引擎 + 内容目录 + 生产消费 + 历练遭遇 ✅
3. M3 NPC 对手宗门 + 宣战会战 + 胜负结局评级 ✅
4. M4 小程序 UI 纵切 🔶（骨架/存档/首页/主界面/弟子殿完成；丹房器坊/仓库/对手情报/战斗回放页接线与真机验证待补）
5. M5 千局调平 ✅（中位 37 游戏年通关，锚点全过）+ 文档收口 ✅

## 数值调平结论

调平只改引擎常量表（`ZHENYUAN_BASE` 10→130、悟性系数 0.1→0.5），公式与月结顺序未动。1200 局（三难度档 ×400）模拟：飞升通关中位 35.9–36.9 游戏年（锚点 30–60 ✅）、吞并/被吞并 0%（锚点 ≤25% ✅）、两宗等级差 ≤1 占比 0.91–0.94（锚点"多数时间" ✅）。详见 `docs/design/2026-09-06-小程序简化版设计.md` §数值调平 与 `scripts/balance-report.json`。
