import { useLaunch } from "@tarojs/taro";
import type { PropsWithChildren } from "react";
import "./app.css";

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    // 开局入口在首页；此处仅做应用级初始化占位。
  });
  return children;
}

export default App;
