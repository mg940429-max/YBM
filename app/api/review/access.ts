export function reviewAccessGranted(request: Request) {
  const expected = process.env.REVIEW_ACCESS_CODE?.trim();
  if (!expected) return true;
  return request.headers.get("x-review-access-code") === expected;
}

export function reviewAccessRequired() {
  return Boolean(process.env.REVIEW_ACCESS_CODE?.trim());
}
