import { useEffect, useRef, type ReactNode } from "react";

/**
 * 录制时的实时预览。
 *
 * 只把 stream 挂到 srcObject 上是不够的：video 不会自己开播，画面就一直是黑的。
 * 要 autoPlay + muted（静音才允许自动播），拿到流之后补一次 play()。
 */
export function LiveVideo({ stream }: { stream: MediaStream | null }): ReactNode {
  const element = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = element.current;
    if (video === null) {
      return;
    }
    video.srcObject = stream;
    if (stream !== null) {
      void video.play().catch(() => {
        // 自动播放被拦时留黑帧，不弹错：用户还能停、能保存
      });
    }
  }, [stream]);

  return (
    <video
      className="omora-video"
      data-type="video-live"
      ref={element}
      autoPlay
      muted
      playsInline
    />
  );
}
