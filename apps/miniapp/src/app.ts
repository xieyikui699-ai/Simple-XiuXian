import { useLaunch } from "@tarojs/taro";
import type { PropsWithChildren } from "react";
import { installSliderMouseBridge } from "./ui/slider-mouse-bridge";
import "./app.css";

// H5 桌面端：Slider 组件只监听 touch 事件，鼠标拖不动，装一个鼠标→触摸桥。
if (process.env.TARO_ENV === "h5") {
  installSliderMouseBridge();
}

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    // 开局入口在首页；此处仅做应用级初始化占位。
  });
  return children;
}

export default App;
