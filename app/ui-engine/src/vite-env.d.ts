/// <reference types="vite/client" />

/**
 * 渲染引擎用到的环境变量。
 *
 * vite/client 的 ImportMetaEnv 带一个 `[key: string]: any` 索引签名，直接读
 * import.meta.env.X 会退化成 any（type-aware lint 会报 no-unsafe-assignment，
 * 人也会把拼错的变量名当成 undefined 而不是错误）。这里把用到的几个显式声明出来，
 * 声明过的键优先于索引签名。
 */
interface ImportMetaEnv {
  readonly VITE_OMORA_LOG?: string;
}
