import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { reviewAccessGranted } from "../../access";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!reviewAccessGranted(request)) {
    return NextResponse.json({ error: "사용 권한 코드를 확인해 주세요." }, { status: 401 });
  }

  try {
    const { runId } = await context.params;
    if (!/^wrun_[A-Za-z0-9_-]+$/.test(runId)) {
      return NextResponse.json({ error: "잘못된 작업 번호입니다." }, { status: 400 });
    }
    const run = getRun<Record<string, unknown>>(runId);
    const status = await run.status;
    if (status === "completed") {
      return NextResponse.json({ status, result: await run.returnValue });
    }
    if (status === "failed" || status === "cancelled") {
      return NextResponse.json({ status, error: "분석 작업이 완료되지 못했습니다. 다시 시도해 주세요." }, { status: 500 });
    }
    return NextResponse.json({ status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "분석 상태를 확인하지 못했습니다." },
      { status: 404 },
    );
  }
}
