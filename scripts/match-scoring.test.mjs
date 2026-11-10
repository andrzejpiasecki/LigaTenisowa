import assert from "node:assert/strict";
import test from "node:test";
import { isFivePointWin } from "../src/lib/match-scoring.ts";

test("wygrana 2:0 przy mniej niż czterech gemach oddanych daje 5 punktów", () => {
  assert.equal(isFivePointWin("2:0", "6:1", "6:2"), true);
  assert.equal(isFivePointWin("2:0", "6:2", "6:2"), false);
  assert.equal(isFivePointWin("2:1", "6:0", "6:0"), false);
  assert.equal(isFivePointWin("2:0", "", "6:0"), false);
});
