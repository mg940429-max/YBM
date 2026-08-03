import { issueSignedToken } from "@vercel/blob";
import {
  handleUpload,
  handleUploadPresigned,
  type HandleUploadBody,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { reviewAccessGranted } from "../access";

const SOURCE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const GUIDE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

export async function POST(request: Request) {
  try {
    const rawBody = await request.json();
    const isOidcBlob = Boolean(process.env.BLOB_STORE_ID && process.env.BLOB_WEBHOOK_PUBLIC_KEY);
    const isTokenRequest = (rawBody as { type?: unknown }).type === "blob.generate-client-token"
      || (rawBody as { type?: unknown }).type === "blob.generate-presigned-url";
    if (isTokenRequest && !reviewAccessGranted(request)) {
      return NextResponse.json({ error: "사용 권한 코드를 확인해 주세요." }, { status: 401 });
    }

    if (isOidcBlob) {
      const response = await handleUploadPresigned({
        request,
        body: rawBody as HandleUploadPresignedBody,
        webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY,
        getSignedToken: async (pathname, clientPayload) => {
          if (!pathname.startsWith("reviews/")) throw new Error("허용되지 않은 업로드 경로입니다.");
          const kind = clientPayload === "guide" ? "guide" : "source";
          const allowedContentTypes = kind === "guide" ? GUIDE_TYPES : SOURCE_TYPES;
          const maximumSizeInBytes = kind === "guide" ? 10 * 1024 * 1024 : 50_000_000;
          return {
            token: await issueSignedToken({
              pathname,
              operations: ["put"],
              allowedContentTypes,
              maximumSizeInBytes,
            }),
            urlOptions: {
              allowedContentTypes,
              maximumSizeInBytes,
              addRandomSuffix: true,
              tokenPayload: kind,
            },
          };
        },
        onUploadCompleted: async () => undefined,
      });
      return NextResponse.json(response);
    }

    const response = await handleUpload({
      request,
      body: rawBody as HandleUploadBody,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!pathname.startsWith("reviews/")) throw new Error("허용되지 않은 업로드 경로입니다.");
        const kind = clientPayload === "guide" ? "guide" : "source";
        return {
          allowedContentTypes: kind === "guide" ? GUIDE_TYPES : SOURCE_TYPES,
          maximumSizeInBytes: kind === "guide" ? 10 * 1024 * 1024 : 50_000_000,
          addRandomSuffix: true,
          tokenPayload: kind,
        };
      },
      onUploadCompleted: async () => undefined,
    });
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "파일 업로드 준비에 실패했습니다." },
      { status: 400 },
    );
  }
}
