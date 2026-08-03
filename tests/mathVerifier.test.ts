import assert from "node:assert/strict";
import test from "node:test";
import { verifyNumericEquality } from "../app/api/review/mathVerifier.ts";

test("분수와 잘못된 유한소수 등식을 검출한다", () => {
  const result = verifyNumericEquality(String.raw`\frac{11}{3}=3.6`);
  assert.equal(result.checked, true);
  assert.equal(result.valid, false);
  assert.deepEqual(result.exactValues, [String.raw`\frac{11}{3}`, String.raw`\frac{18}{5}`]);
});

test("서로 같은 분수 등식을 정확하게 승인한다", () => {
  const result = verifyNumericEquality(String.raw`\frac{27}{99}=\frac{3}{11}`);
  assert.equal(result.checked, true);
  assert.equal(result.valid, true);
});

test("변수가 있는 식은 결정적 검증 대상으로 단정하지 않는다", () => {
  const result = verifyNumericEquality(String.raw`99x=27`);
  assert.equal(result.checked, false);
});
