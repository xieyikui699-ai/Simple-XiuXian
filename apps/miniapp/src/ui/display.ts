// 展示派生：年月、数字、境界的纯展示转换（不承载游戏公式，公式全部在引擎）。
export function turnToYearMonth(turn: number): { year: number; month: number } {
  const year = Math.floor((turn - 1) / 12) + 1;
  const month = ((turn - 1) % 12) + 1;
  return { year, month };
}

export function formatTurn(turn: number): string {
  const { year, month } = turnToYearMonth(turn);
  return `第${year}年${month}月`;
}

export function formatNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  return (
    sign +
    Math.abs(Math.round(value))
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  );
}

export function formatDelta(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

/** 突破真元需求展示：顶点境界需求为 Infinity，显示作 ∞。 */
export function formatZhenyuanRequirement(requiredZhenyuan: number): string {
  return Number.isFinite(requiredZhenyuan) ? formatNumber(requiredZhenyuan) : "∞";
}

/** 存档保存时刻展示：MM-DD HH:mm。 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 境界等级着色（展示层映射，非游戏规则）。 */
export function realmToneClass(realmLevel: number): string {
  if (realmLevel >= 10) return "tone-nascent";
  if (realmLevel >= 7) return "tone-golden";
  if (realmLevel >= 4) return "tone-foundation";
  return "tone-qi";
}

export const GENDER_DISPLAY_NAMES: Record<"male" | "female", string> = {
  male: "男",
  female: "女",
};

export const BREAKTHROUGH_OUTCOME_LABELS: Record<string, string> = {
  success: "突破成功",
  failure: "突破失败",
};
