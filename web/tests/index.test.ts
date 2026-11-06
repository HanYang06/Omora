import { describe, expect, it } from "vitest";

import { PRODUCT } from "../src/index";

describe("product", () => {
  it("has a stable name", () => {
    expect(PRODUCT).toBe("omora");
  });
});
