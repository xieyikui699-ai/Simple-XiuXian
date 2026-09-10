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

export type OptionPickerItem = {
  key: string;
  title: string;
  /** 副文案（效果说明等）。 */
  sub?: string;
  /** 返回文案表示该行被禁用及原因；空串/缺省表示可点选。 */
  disabledReason?: string;
};

export type OptionPickerProps = {
  title: string;
  hint?: string;
  /** 列表为空时的占位文案。 */
  emptyText?: string;
  items: readonly OptionPickerItem[];
  onPick: (key: string) => void;
  /** 未选择即关闭（点遮罩 / 取消按钮）。 */
  onCancel: () => void;
};

/** 通用选项弹层：与 DisciplePicker 同款样式，供"从仓库/藏经阁选用"等场景复用。 */
export function OptionPicker({
  title,
  hint,
  emptyText,
  items,
  onPick,
  onCancel,
}: OptionPickerProps) {
  return (
    <View className="picker-mask" onClick={onCancel}>
      <View className="picker" onClick={(event) => event.stopPropagation()}>
        <Text className="picker-title">{title}</Text>
        {hint !== undefined && <Text className="muted">{hint}</Text>}
        {items.length === 0 && <Text className="muted">{emptyText ?? "没有可选项。"}</Text>}
        {items.map((item) => {
          const reason = item.disabledReason ?? "";
          return (
            <View
              key={item.key}
              className={`picker-row${reason ? " picker-row-disabled" : ""}`}
              onClick={() => {
                if (!reason) onPick(item.key);
              }}
            >
              <Text>{item.title}</Text>
              <Text className="muted">{reason || item.sub}</Text>
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
