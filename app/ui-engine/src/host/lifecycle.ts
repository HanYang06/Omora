/**
 * Dendrolink 引擎生命周期账本（S4 预备）：登记 → 撤销。
 *
 * 语义依据 docs/engine/runtime.md §3「生命周期账本」与 §4「失败隔离」：引擎维护一份
 * 登记表，来源 / 页面 / 会话卸载时按登记逆序撤销；单个撤销失败不拖垮其余，失败项
 * 最后汇总。本模块只做这本账，不碰 DOM、不接运行时（接线属于 S4）。
 *
 * 固定语义：
 * - add(dispose) 返回 remove：remove 撤销登记，被撤销的清理不会执行；已撤销的
 *   登记再 disposeAll 也不会补跑。
 * - disposeAll() 逆序执行所有未撤销的清理，返回本次执行的条数与按执行顺序收集的
 *   原始错误；单个清理抛错只记错误、继续执行其余；可重复调用，第二次返回
 *   { disposed: 0, errors: [] }。
 * - disposeAll 之后 add：账本已收口，清理立即执行（fail-safe，不抛）并返回空
 *   remove——避免卸载之后还有来源往账本里塞清理，把资源泄漏到进程结束。
 * - size / disposed 只读：size 是仍登记着的清理数；disposed 表示账本已收口
 *   （第一次 disposeAll 开始即置位，不是等它跑完）。
 *
 * 边界（写清楚，避免调用方误用）：
 * - 一次登记最多执行一次：已执行或已撤销的清理，后续 disposeAll 不会再跑；对
 *   它们调用 remove 是空操作，不会把已跑过的清理拉起来重跑。
 * - disposeAll 期间再次 add：账本已收口，按上面第三条立即执行。这次立即执行不
 *   进入当前 disposeAll 的 disposed 计数（不是这次结算从账本里跑出来的），也没有
 *   调用点能接收它的错误（add 承诺不抛），所以它的异常被静默丢弃——这是「卸载后
 *   不得再泄漏」的取舍。
 * - disposeAll 期间调用 remove：撤销的是登记，尚未执行到的清理被跳过；不会中断
 *   正在执行的清理。disposeAll 期间重入 disposeAll 直接返回空结算，不重跑。
 * - 严格 LIFO：执行顺序是登记顺序的逆序，与清理内部的耗时 / 异步无关（清理函数
 *   同步，异步收尾不属于本账本的职责）。
 * - 纯模块：不碰 DOM、不改入参、不缓存调用方状态；errors 里放原始抛出值，不包装、
 *   不转成字符串。
 */

/** 一次 disposeAll 的结算：本次执行条数 + 按执行顺序收集的原始错误。 */
export interface DisposeReport {
  /** 本次实际执行过的清理条数（含抛错的；不含已撤销 / 已执行过的）。 */
  disposed: number;
  /** 执行中抛出的原始值，顺序与执行顺序一致。 */
  errors: unknown[];
}

/** 账本里的一条登记；active 置 false 表示已撤销或已执行，永不回到 true。 */
interface LedgerEntry {
  readonly dispose: () => void;
  active: boolean;
}

/** 空 remove：dispose 之后 add 返回的撤销函数没有可撤销的登记。 */
const NOOP = (): void => {};

/**
 * fail-safe 立即执行：dispose 之后 add 的清理没有登记点，错误无处上报，
 * 只保证不把异常抛回调用方（add 本身不能成为失败源）。
 */
function runDetached(dispose: () => void): void {
  try {
    dispose();
  } catch {
    // 故意吞掉：见文件头「disposeAll 期间再次 add」的边界说明。
  }
}

/**
 * 引擎生命周期账本：登记清理函数，卸载时逆序撤销。
 *
 * 用法：
 * ```ts
 * const ledger = new LifecycleLedger();
 * const remove = ledger.add(() => subscription.unsubscribe());
 * // 来源卸载：
 * remove(); // 撤销；或
 * ledger.disposeAll(); // 逆序执行全部，返回失败汇总
 * ```
 */
export class LifecycleLedger {
  /** 仍登记着、尚未撤销 / 执行的清理，按登记顺序排列。 */
  private readonly entries: LedgerEntry[] = [];
  /** 账本是否已收口：第一次 disposeAll 开始即置 true。 */
  private disposeStarted = false;

  /** 仍登记着的清理数。 */
  get size(): number {
    return this.entries.length;
  }

  /** 账本是否已收口（disposeAll 已开始 / 已执行过）。 */
  get disposed(): boolean {
    return this.disposeStarted;
  }

  /**
   * 登记一个清理函数，返回撤销登记的函数。
   *
   * - 正常登记：返回的 remove 撤销登记；重复调用 remove 是空操作。
   * - 账本已收口：清理立即执行（fail-safe，不抛），返回空 remove。
   */
  add(dispose: () => void): () => void {
    if (this.disposeStarted) {
      runDetached(dispose);
      return NOOP;
    }
    const entry: LedgerEntry = { dispose, active: true };
    this.entries.push(entry);
    return (): void => {
      if (!entry.active) {
        return;
      }
      entry.active = false;
      const index = this.entries.indexOf(entry);
      if (index !== -1) {
        this.entries.splice(index, 1);
      }
    };
  }

  /**
   * 逆序执行所有未撤销的清理，返回本次结算。
   *
   * 可重复调用：账本已收口后直接返回 { disposed: 0, errors: [] }，不会补跑。
   * 单个清理抛错不影响其余，错误按执行顺序原样收进 errors。
   */
  disposeAll(): DisposeReport {
    if (this.disposeStarted) {
      return { disposed: 0, errors: [] };
    }
    this.disposeStarted = true;
    // 先把登记摘空：执行期间的 add 走立即执行路径，执行期间的 remove 也不该再从
    // 账本里改到当前这一批；条目自身的 active 负责「撤销了的跳过」。
    const pending = this.entries.splice(0);
    const errors: unknown[] = [];
    let disposed = 0;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const entry = pending[index];
      if (entry === undefined || !entry.active) {
        continue;
      }
      // 先置 false 再执行：同一条登记不会因为重入 / 递归被执行两次。
      entry.active = false;
      try {
        entry.dispose();
      } catch (error) {
        errors.push(error);
      }
      disposed += 1;
    }
    return { disposed, errors };
  }
}
