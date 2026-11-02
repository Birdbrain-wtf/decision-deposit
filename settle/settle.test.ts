import { expect, test } from "bun:test";
import { decide } from "./settle";
const base = { state: 0, total: 435n, deposit: 667n, deadline: 100n, count: 8n, now: 101n };
test("open before the deadline waits", () => expect(decide({ ...base, now: 99n })).toBe("wait"));
test("open and short after the deadline closes", () => expect(decide(base)).toBe("abandon"));
test("full after the deadline is never closed", () => expect(decide({ ...base, total: 667n })).toBe("full-not-placed"));
test("placed does nothing", () => expect(decide({ ...base, state: 1 })).toBe("nothing"));
test("returning with money owed pays out", () => expect(decide({ ...base, state: 2 })).toBe("payout"));
test("returning and settled does nothing", () => expect(decide({ ...base, state: 2, total: 0n })).toBe("nothing"));
