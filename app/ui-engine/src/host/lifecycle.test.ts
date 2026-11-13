import { describe, expect, it } from "vitest";
import { LifecycleLedger } from "./lifecycle";

/** 记录执行顺序的清理函数。 */
function recorder(order: string[], name: string): () => void {
  return () => {
    order.push(name);
  };
}

describe("LifecycleLedger：登记与逆序撤销", () => {
  it("按登记顺序的逆序执行全部清理", () => {
    const ledger = new LifecycleLedger();
    const order: string[] = [];
    ledger.add(recorder(order, "first"));
    ledger.add(recorder(order, "second"));
    ledger.add(recorder(order, "third"));

    expect(ledger.size).toBe(3);
    const report = ledger.disposeAll();

    expect(order).toEqual(["third", "second", "first"]);
    expect(report).toEqual({ disposed: 3, errors: [] });
    expect(ledger.size).toBe(0);
    expect(ledger.disposed).toBe(true);
  });

  it("remove 撤销登记后清理不执行，size 同步减少", () => {
    const ledger = new LifecycleLedger();
    const order: string[] = [];
    const removeFirst = ledger.add(recorder(order, "first"));
    ledger.add(recorder(order, "second"));

    removeFirst();
    removeFirst(); // remove 幂等：第二次调用不报错也不改变状态

    expect(ledger.size).toBe(1);
    const report = ledger.disposeAll();
    expect(order).toEqual(["second"]);
    expect(report).toEqual({ disposed: 1, errors: [] });
  });

  it("remove 只撤销目标登记，其余仍按逆序执行", () => {
    const ledger = new LifecycleLedger();
    const order: string[] = [];
    ledger.add(recorder(order, "first"));
    const removeSecond = ledger.add(recorder(order, "second"));
    ledger.add(recorder(order, "third"));

    removeSecond();
    ledger.disposeAll();

    expect(order).toEqual(["third", "first"]);
  });

  it("重复 disposeAll 幂等：第二次返回空结算且不补跑", () => {
    const ledger = new LifecycleLedger();
    const order: string[] = [];
    ledger.add(recorder(order, "only"));

    const first = ledger.disposeAll();
    const second = ledger.disposeAll();

    expect(first).toEqual({ disposed: 1, errors: [] });
    expect(second).toEqual({ disposed: 0, errors: [] });
    expect(order).toEqual(["only"]);
  });

  it("单个清理抛错不中断其余，errors 按逆序执行顺序保留原始错误", () => {
    const ledger = new LifecycleLedger();
    const order: string[] = [];
    const earlyError = new Error("先登记、后执行：失败");
    const lateError = new Error("后登记、先执行：失败");
    ledger.add(() => {
      order.push("ok-early");
    });
    ledger.add(() => {
      order.push("throw-early");
      throw earlyError;
    });
    ledger.add(() => {
      order.push("throw-late");
      throw lateError;
    });
    ledger.add(() => {
      order.push("ok-late");
    });

    const report = ledger.disposeAll();

    // 逆序：ok-late → throw-late → throw-early → ok-early；抛错没有截断后面两条。
    expect(order).toEqual(["ok-late", "throw-late", "throw-early", "ok-early"]);
    expect(report.disposed).toBe(4);
    expect(report.errors).toHaveLength(2);
    expect(report.errors[0]).toBe(lateError);
    expect(report.errors[1]).toBe(earlyError);
  });

  it("errors 保留非 Error 的原始抛出值，不转成字符串", () => {
    const ledger = new LifecycleLedger();
    const thrown = { reason: "boom" } as unknown as Error;
    ledger.add(() => {
      throw thrown;
    });

    const report = ledger.disposeAll();

    expect(report.errors[0]).toBe(thrown);
  });

  it("size / disposed 只读状态随登记、撤销与收口变化", () => {
    const ledger = new LifecycleLedger();
    expect(ledger.size).toBe(0);
    expect(ledger.disposed).toBe(false);

    const remove = ledger.add(() => {});
    expect(ledger.size).toBe(1);

    remove();
    expect(ledger.size).toBe(0);
    expect(ledger.disposed).toBe(false);

    ledger.disposeAll();
    expect(ledger.disposed).toBe(true);
  });

  it("空账本 disposeAll 返回空结算并收口", () => {
    const ledger = new LifecycleLedger();

    expect(ledger.disposeAll()).toEqual({ disposed: 0, errors: [] });
    expect(ledger.disposed).toBe(true);
  });

  it("清理函数只跑一次：disposeAll 之后 remove 再 disposeAll 不重跑", () => {
    const ledger = new LifecycleLedger();
    const order: string[] = [];
    const remove = ledger.add(recorder(order, "once"));

    ledger.disposeAll();
    remove(); // 已执行的登记：remove 是空操作，不会把清理拉起来
    const second = ledger.disposeAll();

    expect(second).toEqual({ disposed: 0, errors: [] });
    expect(order).toEqual(["once"]);
  });
});

describe("LifecycleLedger：收口后的 fail-safe", () => {
  it("dispose 之后再 add 立即执行并返回空 remove", () => {
    const ledger = new LifecycleLedger();
    ledger.disposeAll();
    const order: string[] = [];

    const remove = ledger.add(recorder(order, "late"));

    expect(order).toEqual(["late"]);
    expect(ledger.size).toBe(0);

    remove(); // 空 remove：无需撤销，也不会重跑
    expect(order).toEqual(["late"]);
    expect(ledger.disposeAll()).toEqual({ disposed: 0, errors: [] });
  });

  it("dispose 之后 add 的清理抛错不向外抛，也不进后续结算", () => {
    const ledger = new LifecycleLedger();
    ledger.disposeAll();

    expect(() => {
      ledger.add(() => {
        throw new Error("迟到清理失败");
      });
    }).not.toThrow();
    expect(ledger.size).toBe(0);
    expect(ledger.disposeAll()).toEqual({ disposed: 0, errors: [] });
  });
});

describe("LifecycleLedger：撤销与执行期间的重入", () => {
  it("disposeAll 期间撤销尚未执行的登记 → 该清理被跳过", () => {
    const ledger = new LifecycleLedger();
    const order: string[] = [];
    const removeEarly = ledger.add(recorder(order, "early"));
    ledger.add(() => {
      order.push("late");
      removeEarly();
    });

    const report = ledger.disposeAll();

    expect(order).toEqual(["late"]);
    expect(report).toEqual({ disposed: 1, errors: [] });
  });

  it("disposeAll 期间 add 的清理立即执行，不进入本次结算", () => {
    const ledger = new LifecycleLedger();
    const order: string[] = [];
    ledger.add(() => {
      order.push("outer");
      const remove = ledger.add(recorder(order, "inner"));
      remove(); // 立即执行过的清理：空 remove，不重跑
    });

    const report = ledger.disposeAll();

    expect(order).toEqual(["outer", "inner"]);
    expect(report).toEqual({ disposed: 1, errors: [] });
    expect(ledger.size).toBe(0);
    expect(ledger.disposeAll()).toEqual({ disposed: 0, errors: [] });
  });

  it("清理里重入 disposeAll 返回空结算，不重复执行其余清理", () => {
    const ledger = new LifecycleLedger();
    const order: string[] = [];
    ledger.add(recorder(order, "early"));
    ledger.add(() => {
      order.push("late");
      expect(ledger.disposeAll()).toEqual({ disposed: 0, errors: [] });
    });

    const report = ledger.disposeAll();

    expect(order).toEqual(["late", "early"]);
    expect(report).toEqual({ disposed: 2, errors: [] });
  });
});
