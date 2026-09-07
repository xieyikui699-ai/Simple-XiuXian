// 共享选人组件：内门弟子列表（可按谓词过滤），点选后回调。
import { realmStageForLevel } from "@simple-xiuxian/engine";
import type { Disciple } from "@simple-xiuxian/engine";
import { Text, View } from "@tarojs/components";
import "./picker.css";

export type DisciplePickerProps = {
  title: string;
  hint?: string;
  disciples: readonly Disciple[];
  /** 返回空串表示可点选；返回文案表示该行被禁用及原因。 */
  disabledReason?: (disciple: Disciple) => string;
  onPick: (discipleId: string) => void;
};

export function DisciplePicker({
  title,
  hint,
  disciples,
  disabledReason,
  onPick,
}: DisciplePickerProps) {
  return (
    <View className="picker">
      <Text className="picker-title">{title}</Text>
      {hint !== undefined && <Text className="muted">{hint}</Text>}
      {disciples.length === 0 && <Text className="muted">没有可选弟子。</Text>}
      {disciples.map((disciple) => {
        const reason = disabledReason?.(disciple) ?? "";
        return (
          <View
            key={disciple.id}
            className={`picker-row${reason ? " picker-row-disabled" : ""}`}
            onClick={() => {
              if (!reason) onPick(disciple.id);
            }}
          >
            <Text>
              {disciple.name} · {disciple.realm} Lv.{disciple.realmLevel}
            </Text>
            <Text className="muted">
              {reason ||
                `真元 ${disciple.zhenyuan}/${realmStageForLevel(disciple.realmLevel).requiredZhenyuan}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
