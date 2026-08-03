export type EquationCheck = {
  page: number;
  sourcePage: string;
  expression: string;
  context: string;
};

type Rational = { numerator: bigint; denominator: bigint };

function absolute(value: bigint) {
  return value < 0n ? -value : value;
}

function greatestCommonDivisor(left: bigint, right: bigint) {
  let a = absolute(left);
  let b = absolute(right);
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new Error("0으로 나눌 수 없습니다.");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: sign * numerator / divisor, denominator: absolute(denominator) / divisor };
}

function add(left: Rational, right: Rational) {
  return rational(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator);
}

function subtract(left: Rational, right: Rational) {
  return rational(left.numerator * right.denominator - right.numerator * left.denominator, left.denominator * right.denominator);
}

function multiply(left: Rational, right: Rational) {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divide(left: Rational, right: Rational) {
  return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

function power(base: Rational, exponent: bigint) {
  if (absolute(exponent) > 20n) throw new Error("지수가 너무 큽니다.");
  if (exponent === 0n) return rational(1n);
  const count = Number(absolute(exponent));
  const powered = rational(base.numerator ** BigInt(count), base.denominator ** BigInt(count));
  return exponent < 0n ? rational(powered.denominator, powered.numerator) : powered;
}

function decimalToRational(value: string) {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart, decimalPart = ""] = unsigned.split(".");
  const denominator = 10n ** BigInt(decimalPart.length);
  const numerator = BigInt(`${integerPart || "0"}${decimalPart}` || "0") * (negative ? -1n : 1n);
  return rational(numerator, denominator);
}

function normalizeLatex(value: string) {
  let normalized = value
    .replace(/```(?:latex|tex)?/gi, "")
    .replace(/\$\$/g, "")
    .replace(/\$/g, "")
    .replace(/\\left|\\right/g, "")
    .replace(/\\(?:times|cdot)/g, "*")
    .replace(/\\div/g, "/")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/\\[,;! ]/g, "")
    .trim();

  for (let index = 0; index < 8; index += 1) {
    const next = normalized.replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "(($1)/($2))");
    if (next === normalized) break;
    normalized = next;
  }
  return normalized.replace(/\{/g, "(").replace(/\}/g, ")");
}

class RationalParser {
  private index = 0;
  private readonly tokens: string[];

  constructor(tokens: string[]) {
    this.tokens = tokens;
  }

  parse() {
    const result = this.parseSum();
    if (this.index !== this.tokens.length) throw new Error("지원하지 않는 수식입니다.");
    return result;
  }

  private peek() {
    return this.tokens[this.index];
  }

  private take() {
    return this.tokens[this.index++];
  }

  private parseSum(): Rational {
    let value = this.parseProduct();
    while (this.peek() === "+" || this.peek() === "-") {
      const operator = this.take();
      const right = this.parseProduct();
      value = operator === "+" ? add(value, right) : subtract(value, right);
    }
    return value;
  }

  private parseProduct(): Rational {
    let value = this.parsePower();
    while (this.peek() === "*" || this.peek() === "/") {
      const operator = this.take();
      const right = this.parsePower();
      value = operator === "*" ? multiply(value, right) : divide(value, right);
    }
    return value;
  }

  private parsePower(): Rational {
    let value = this.parseUnary();
    if (this.peek() === "^") {
      this.take();
      const exponent = this.parseUnary();
      if (exponent.denominator !== 1n) throw new Error("정수 지수만 지원합니다.");
      value = power(value, exponent.numerator);
    }
    return value;
  }

  private parseUnary(): Rational {
    if (this.peek() === "+") {
      this.take();
      return this.parseUnary();
    }
    if (this.peek() === "-") {
      this.take();
      return multiply(rational(-1n), this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Rational {
    const token = this.take();
    if (token === "(") {
      const value = this.parseSum();
      if (this.take() !== ")") throw new Error("괄호가 일치하지 않습니다.");
      return value;
    }
    if (!token || !/^\d+(?:\.\d+)?$/.test(token)) throw new Error("숫자가 필요합니다.");
    return decimalToRational(token);
  }
}

function evaluateNumericExpression(value: string) {
  const expression = normalizeLatex(value).replace(/\s+/g, "");
  if (!expression || /[A-Za-z가-힣\\]/.test(expression)) return null;
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/^]/g) ?? [];
  if (tokens.join("") !== expression) return null;
  try {
    return new RationalParser(tokens).parse();
  } catch {
    return null;
  }
}

function sameRational(left: Rational, right: Rational) {
  return left.numerator === right.numerator && left.denominator === right.denominator;
}

function formatRational(value: Rational) {
  return value.denominator === 1n
    ? value.numerator.toString()
    : `\\frac{${value.numerator.toString()}}{${value.denominator.toString()}}`;
}

export type NumericEqualityResult = {
  checked: boolean;
  valid: boolean;
  exactValues: string[];
};

export function verifyNumericEquality(expression: string): NumericEqualityResult {
  const parts = normalizeLatex(expression).split("=").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { checked: false, valid: true, exactValues: [] };
  const values = parts.map(evaluateNumericExpression);
  if (values.some((value) => value === null)) return { checked: false, valid: true, exactValues: [] };
  const exactValues = (values as Rational[]).map(formatRational);
  return {
    checked: true,
    valid: (values as Rational[]).every((value, index, array) => index === 0 || sameRational(array[index - 1], value)),
    exactValues,
  };
}

export function buildDeterministicMathItems(checks: EquationCheck[]) {
  const seen = new Set<string>();
  let checkedCount = 0;
  const items: Record<string, unknown>[] = [];

  for (const check of checks) {
    const key = `${check.page}:${normalizeLatex(check.expression).replace(/\s+/g, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const result = verifyNumericEquality(check.expression);
    if (!result.checked) continue;
    checkedCount += 1;
    if (result.valid) continue;
    items.push({
      page: check.page,
      sourcePage: check.sourcePage,
      type: "math",
      judgment: "수정 권고",
      title: "계산 엔진 검증: 성립하지 않는 등식",
      description: `추출된 등식의 양변을 정확한 유리수로 계산한 결과가 서로 다릅니다. 계산값: ${result.exactValues.join(" ≠ ")}`,
      before: `$$${check.expression}$$`,
      after: `정확한 계산값 ${result.exactValues.map((value) => `$${value}$`).join("과 ")}을 대조하여 등식을 수정하세요.`,
      standard: "정확한 유리수 연산에 따른 등식 성립 여부",
      referenceUrl: "",
      format: "text",
      verificationMethod: "deterministic",
      verificationEvidence: `정확한 유리수 연산: ${result.exactValues.join(" / ")}`,
    });
  }

  return { items, checkedCount };
}
