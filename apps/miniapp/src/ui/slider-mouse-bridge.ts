// H5 桌面端滑杆鼠标桥：Taro 的 H5 Slider（taro-slider-core）只监听 touchstart/move/end，
// 桌面浏览器鼠标拖不动把手；这里把手势翻译成合成 touch 事件派发给把手元素。
// 仅在 app.ts 里以 TARO_ENV === "h5" 守卫安装（weapp 构建摇树移除），触屏真机不受影响。

type MinimalTouch = { identifier: number; pageX: number; pageY: number };

function dispatchSyntheticTouch(target: EventTarget, type: string, pageX: number): void {
  const touch: MinimalTouch = { identifier: 1, pageX, pageY: 0 };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    touches: type === "touchend" ? [] : [touch],
    targetTouches: type === "touchend" ? [] : [touch],
    changedTouches: [touch],
  });
  target.dispatchEvent(event);
}

export function installSliderMouseBridge(): void {
  if (typeof document === "undefined") return;
  document.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const handle = target.closest(".weui-slider__handler");
    if (!handle) return;
    const host = handle.closest("taro-slider-core");
    if (host && (host as HTMLElement & { disabled?: boolean }).disabled === true) return;
    // 阻止拖动时的文本选取；mousedown 默认非 passive，可以 preventDefault。
    event.preventDefault();
    dispatchSyntheticTouch(handle, "touchstart", event.pageX);
    const onMove = (move: MouseEvent) => {
      dispatchSyntheticTouch(handle, "touchmove", move.pageX);
    };
    const onUp = (up: MouseEvent) => {
      dispatchSyntheticTouch(handle, "touchend", up.pageX);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}
