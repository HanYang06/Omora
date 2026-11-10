import type { ReactNode } from "react";
import { prop, type NodeComponentProps } from "./shared";

/** video：一条视频。播放走 HTTP 媒体通道，字节不进快照。 */
export function VideoPlayer({ node }: NodeComponentProps): ReactNode {
  const src = prop(node, "src");
  const media = prop(node, "media") ?? "";
  if (src === undefined || src.length === 0) {
    return (
      <span className="omora-video-missing" data-type="video" data-media={media}>
        媒体通道未就绪
      </span>
    );
  }
  return (
    <video
      className="omora-video"
      data-type="video"
      data-media={media}
      src={src}
      controls
      preload="metadata"
      playsInline
    />
  );
}
