// 共享选人组件：模态底部弹层——按下即盖住当前屏（无需滚动可见），点遮罩或「取消」关闭，点行选中。
import { realmStageForLevel } from "@simple-xiuxian/engine";
import type { Disciple } from "@simple-xiuxian/engine";
import { Button, Text, View } from "@tarojs/components";
import { formatZhenyuanRequirement } from "./display";
import "./picker.css";

export type DisciplePickerProps = {
  title: string;
  hint?: string;
  disciples: readonly Disciple[];
  /** 返回空串表示可点选；返回文案表示该行被禁用及原因。 */
  disabledReason?: (disciple: Disciple) => string;
  /** 可点选行的副文案；缺省显示真元进度。 */
  subText?: (disciple: Disciple) => string;
  onPick: (discipleId: string) => void;
  /** 未选择即关闭（点遮罩 / 取消按钮）。 */
  onCancel: () => void;
};

export function DisciplePicker({
  title,
  hint,
  disciples,
  disabledReason,
  subText,
  onPick,
  onCancel,
}: DisciplePickerProps) {
  return (
    <View className="picker-mask" onClick={onCancel}>
      <View className="picker" onClick={(event) => event.stopPropagation()}>
        <Text className="picker-title">{title}</Text>
        {hint !== undefined && <Text className="muted">{hint}</Text>}
        {disciples.length === 0 && <Text className="muted">没有可选弟子。</Text>}
        {disciples.map((disciple) => {
          const reason = disabledReason?.(disciple) ?? "";
          const stageName = realmStageForLevel(disciple.realmLevel).name;
          return (
            <View
              key={disciple.id}
              className={`picker-row${reason ? " picker-row-disabled" : ""}`}
              onClick={() => {
                if (!reason) onPick(disciple.id);
              }}
            >
              {subText === undefined ? (
                <>
                  <Text>
                    {disciple.name} · {stageName}
                  </Text>
                  <Text className="muted">
                    {reason ||
                      `真元 ${disciple.zhenyuan}/${formatZhenyuanRequirement(realmStageForLevel(disciple.realmLevel).requiredZhenyuan)}`}
                  </Text>
                </>
              ) : (
                <View className="picker-row-line">
                  <Text>
                    {disciple.name} · {stageName}
                  </Text>
                  <Text className="muted picker-row-sub">{reason || subText(disciple)}</Text>
                </View>
              )}
            </View>
          );
        })}
        <Button className="picker-cancel" onClick={onCancel}>
          取消
        </Button>
      </View>
    </View>
  );
}
