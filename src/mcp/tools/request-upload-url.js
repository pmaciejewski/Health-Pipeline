import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const EXPIRES_SECONDS = 900;

export async function createUploadUrl(ctx) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `uploads/export-${stamp}.json`;
  const url = await getSignedUrl(
    ctx.s3,
    new PutObjectCommand({ Bucket: ctx.bucket, Key: key }),
    { expiresIn: EXPIRES_SECONDS }
  );
  return { upload_url: url, key, expires_in_seconds: EXPIRES_SECONDS };
}

export const requestUploadUrl = {
  name: "request_upload_url",
  description:
    "Generate a pre-signed S3 URL for uploading a Health Auto Export JSON file. " +
    "The user PUTs the JSON to the returned URL (valid 15 minutes); parsing " +
    "starts automatically after upload and takes a minute or two.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },

  async handler(_args, ctx) {
    const result = await createUploadUrl(ctx);
    return {
      ...result,
      instructions:
        "Upload the Health Auto Export JSON file with an HTTP PUT to upload_url " +
        `within ${result.expires_in_seconds / 60} minutes. On iPhone, use the ` +
        "Health Auto Export app's automation or the Files app share sheet. " +
        "Parsing runs automatically once the upload completes; check " +
        "get_sync_status afterwards.",
    };
  },
};
