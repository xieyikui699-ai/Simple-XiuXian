import { useSyncExternalStore } from "react";
import { getGameStore } from "./use-game";

/**
 * 自动推进控制器：全局唯一计时器（1.5 秒 1 月）+ 全局共享开关状态。
 * 切页时页面栈中可能同时存在多个页面的 AdvanceBar，
 * 计时器必须全局长单例，否则多页并存会重复 tick 导致推进加速；
 * 开关状态同样全局共享，离页/回页不改变“自动推进”的勾选。
 */

export interface AutoAdvanceState {
  enabled: boolean;
}

export interface AutoAdvanceController {
  getState(): AutoAdvanceState;
  setEnabled(enabled: boolean): void;
  subscribe(listener: () => void): () => void;
}

const INTERVAL_MS = 1500;
const AUTO_ADVANCE_GLOBAL_KEY = "__simple_xiuxian_auto_advance__";

function createController(): AutoAdvanceController {
  let state: AutoAdvanceState = { enabled: false };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function applyTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (state.enabled) {
      timer = setInterval(() => getGameStore().autoTick(), INTERVAL_MS);
    }
  }

  return {
    getState() {
      return state;
    },
    setEnabled(enabled: boolean) {
      if (state.enabled === enabled) return;
      state = { enabled };
      for (const listener of listeners) listener();
      applyTimer();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * 会话单例：与游戏仓库同一策略，挂到 globalThis。
 * Taro H5 按页分包时本模块可能被复制进多个页面 chunk，globalThis 保证跨页共享同一控制器。
 */
function getController(): AutoAdvanceController {
  const host = globalThis as Record<string, unknown>;
  const existing = host[AUTO_ADVANCE_GLOBAL_KEY];
  if (
    existing instanceof Object &&
    typeof (existing as AutoAdvanceController).getState === "function"
  ) {
    return existing as AutoAdvanceController;
  }
  const controller = createController();
  host[AUTO_ADVANCE_GLOBAL_KEY] = controller;
  return controller;
}

/** 自动推进 React 订阅：返回当前开关状态与 setter（全局共享，全应用至多一个计时器）。 */
export function useAutoAdvance(): {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
} {
  const controller = getController();
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  return { enabled: state.enabled, setEnabled: controller.setEnabled };
}
