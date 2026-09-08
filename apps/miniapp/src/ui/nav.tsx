// H5 专属顶部返回栏：小程序端有原生导航条，编译期整段剔除。
import { Text, View } from "@tarojs/components";
import { navigateBack } from "@tarojs/taro";
import "./nav.css";

export function BackBar({ title }: { title: string }) {
  if (process.env.TARO_ENV !== "h5") return null;
  return (
    <View className="back-bar" onClick={() => navigateBack()}>
      <Text className="back-bar-arrow">‹</Text>
      <Text className="back-bar-title">{title}</Text>
    </View>
  );
}
