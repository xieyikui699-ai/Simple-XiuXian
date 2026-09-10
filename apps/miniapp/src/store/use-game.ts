import type { GameState } from "@simple-xiuxian/engine";
import { getStorageSync, removeStorageSync, setStorageSync } from "@tarojs/taro";
// UI 层绑定：React 订阅 hook + 单格自动档持久化。
// 自动推进计时器见 ./auto-advance（全局单例，跨页共享）。
// 自动档：每次会话状态变化即写（SAVE_KEY）；终局（state.ending）即删档——存档只保留可续的局。
// 启动时清除历史版本多格存档的残留 key（简化版前格式，不做迁移）。
import { useSyncExternalStore } from "react";
import { type AutoSaveData, SAVE_KEY, parseAutoSave, serializeAutoSave } from "./auto-save";
import { type GameSnapshot, type GameStore, createGameStore } from "./game-store";

/** 历史版本多格存档 key（手动 1–3 格 + 自动格 + 当前局指针），启动时一次性清除。 */
const LEGACY_SAVE_KEYS = [
  "simple-xiuxian-save-1",
  "simple-xiuxian-save-2",
  "simple-xiuxian-save-3",
  "simple-xiuxian-save-4",
  "simple-xiuxian-current-slot",
];

function removeLegacySaves(): void {
  for (const key of LEGACY_SAVE_KEYS) {
    try {
      removeStorageSync(key);
    } catch {
      // 存储不可用时忽略：不影响游戏进行。
    }
  }
}

/** 单格自动档：状态一变即写（引用比较；引擎命令恒返回新 state 对象）；终局即删。 */
function wireAutoSave(store: GameStore): void {
  let lastState: GameState | null = null;
  store.subscribe(() => {
    const { state, difficulty } = store.getState();
    if (state === lastState) return;
    lastState = state;
    if (!state) return;
    try {
      if (state.ending) {
        removeStorageSync(SAVE_KEY);
      } else {
        setStorageSync(
          SAVE_KEY,
          serializeAutoSave({ version: 1, savedAt: Date.now(), difficulty, state }),
        );
      }
    } catch {
      // 存储不可用时忽略：不阻断游戏进行。
    }
  });
}

/** 读取当前自动档（无档/损坏/存储不可用返回 null）。 */
export function readAutoSave(): AutoSaveData | null {
  let raw: unknown;
  try {
    raw = getStorageSync(SAVE_KEY);
  } catch {
    return null;
  }
  return parseAutoSave(typeof raw === "string" ? raw : null);
}

let singleton: GameStore | null = null;

/**
 * 会话仓库单例：挂在全局对象上。
 * Taro H5 按页分包时 store 模块可能被复制进多个页面 chunk（各持独立模块级 singleton），
 * 挂到 globalThis 保证跨页共享同一实例；weapp 全员同一线程作用域，行为不变。
 */
const STORE_GLOBAL_KEY = "__simple_xiuxian_game_store__";

export function getGameStore(): GameStore {
  const host = globalThis as Record<string, unknown>;
  const existing = host[STORE_GLOBAL_KEY];
  if (existing instanceof Object && typeof (existing as GameStore).getState === "function") {
    singleton = existing as GameStore;
  }
  if (!singleton) {
    removeLegacySaves();
    singleton = createGameStore();
    wireAutoSave(singleton);
    host[STORE_GLOBAL_KEY] = singleton;
  }
  return singleton;
}

export function useGame(): GameSnapshot {
  const store = getGameStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}
