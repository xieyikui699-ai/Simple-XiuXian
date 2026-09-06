# Simple XiuXian（《掌门，不好了》小程序简化版）

纯单机文字修仙经营游戏，微信小程序目标平台。独立于主仓（`D:\3.开发\XiuXian`）的产品线。

权威设计：`docs/design/2026-09-06-小程序简化版设计.md`。

## 结构

- `packages/engine`：确定性规则引擎（纯 TypeScript，无 Node 依赖，可打包进小程序）。
- `apps/miniapp`：小程序壳（M4 里程碑，尚未创建）。

## 命令

```
pnpm install
pnpm validate   # lint + typecheck + test
pnpm build
```

## 里程碑

1. M1 引擎月结闭环（当前）
2. M2 战斗与会战、丹药/装备
3. M3 NPC 对手宗门与胜负判定
4. M4 小程序 UI 纵切
5. M5 数值调平与体验版
