/**
 * 视频录制质量：分辨率、码率与开流约束。
 *
 * 纯参数，与设备门禁无关；单独放一处，捕捉条只读它、不自己拼约束。
 */

const SIZE: Record<string, { width: number; height: number }> = {
  "480p": { width: 640, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
};

/** 码率按分辨率给，别吃浏览器默认：低默认码率会把本来就不好的镜头糊得更惨。 */
export const QUALITY_BITRATE: Record<string, number> = {
  "480p": 1_200_000,
  "720p": 2_800_000,
  "1080p": 5_000_000,
};

/**
 * 开流之后先空转一会儿再录。
 *
 * 摄像头刚打开时曝光 / 白平衡在做第一次收敛，那几百毫秒画面会明显跳一下；
 * 不预热的话，这段跳变会被录进文件头部。
 */
export const WARMUP_MS = 400;

export const DEFAULT_SECONDS = 120;

/** 质量档 → 开流约束；16:9 与帧率要显式要，别吃摄像头默认。 */
export function videoConstraints(quality: string, deviceId?: string): MediaTrackConstraints {
  const size = SIZE[quality] ?? SIZE["720p"];
  const video: MediaTrackConstraints = {
    width: { ideal: size?.width ?? 1280 },
    height: { ideal: size?.height ?? 720 },
    aspectRatio: { ideal: 16 / 9 },
    frameRate: { ideal: 30, max: 30 },
    resizeMode: "none",
  };
  if (deviceId !== undefined && deviceId.length > 0) {
    video.deviceId = { ideal: deviceId };
  }
  return video;
}

/** 720p 的码率；认不出质量档时就用它。 */
const FALLBACK_BITRATE = 2_800_000;

/** 质量档 → 码率；不认识的就按 720p。 */
export function videoBitrate(quality: string): number {
  return QUALITY_BITRATE[quality] ?? FALLBACK_BITRATE;
}
