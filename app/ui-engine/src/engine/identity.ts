/**
 * 身份编码：本地 code 与全链 addr 的确定性派生（与 Python identity.py 同形）。
 *
 * code = SHA-256(seed) 前 10 字节的 base32（16 字符）
 * addr = SHA-256(parent.addr + SEP + code) 前 10 字节的 base32
 *
 * 用 WebCrypto，浏览器与 Node 都能跑；派生结果是纯函数，调用方缓存即可。
 */

const SEP = "\x1f";
const SHORT_BYTES = 10;
const ADDR_BYTES = 10;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base32(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31] ?? "";
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31] ?? "";
  }
  return out;
}

async function digest(seed: string, bytes: number): Promise<string> {
  const data = new TextEncoder().encode(seed);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base32(new Uint8Array(hash).slice(0, bytes));
}

/** 稳定种子 → 16 字符本地身份编码。 */
export async function shortCode(seed: string): Promise<string> {
  if (seed === "") {
    throw new Error("identity.seed 必须是非空字符串");
  }
  return digest(seed, SHORT_BYTES);
}

/** 父 addr + 本地 code → 子 addr；根节点 parent 传 null。 */
export async function chainAddr(parentAddr: string | null, code: string): Promise<string> {
  if (code === "") {
    throw new Error("identity.code 必须是非空字符串");
  }
  return digest((parentAddr ?? "") + SEP + code, ADDR_BYTES);
}

/** 返回 {code, addr}，便于一次调用。 */
export async function nodeIdentity(
  parentAddr: string | null,
  seed: string,
): Promise<{ code: string; addr: string }> {
  const code = await shortCode(seed);
  return { code, addr: await chainAddr(parentAddr, code) };
}
