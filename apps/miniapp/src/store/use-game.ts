import type { MonthlyPolicy } from "@simple-xiuxian/engine";
import { getStorageSync, removeStorageSync, setStorageSync } from "@tarojs/taro";
// UI 层绑定：wx.setStorage 后端注入 + React 订阅 hook + 自动推进定时器（1 秒 1 月，可暂停）。
import { useEffect, useSyncExternalStore } from "react";
import { type GameSnapshot, type GameStore, createGameStore } from "./game-store";
import type { SaveBackend } from "./save-adapter";

const taroBackend: SaveBackend = {
  getItem(key) {
    try {
      const value = getStorageSync(key);
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    setStorageSync(key, value);
  },
  removeItem(key) {
    removeStorageSync(key);
  },
};

let singleton: GameStore | null = null;

export function getGameStore(): GameStore {
  if (!singleton) singleton = createGameStore(taroBackend);
  return singleton;
}

export function useGame(): GameSnapshot {
  const store = getGameStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** 自动推进：开启期间每 intervalMs 毫秒推进一月；关闭或组件卸载即暂停。 */
export function useAutoAdvance(enabled: boolean, policy: MonthlyPolicy, intervalMs = 1000): void {
  const store = getGameStore();
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      store.autoTick(policy);
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, policy, intervalMs, store]);
}
