import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const EXPIRES_SECONDS = 900;

// Apple Health "Export All Health Data" produces a ZIP; the "Health Auto
// Export" app produces a JSON document. The parser branches on the key suffix,
// so the requested format decides the extension.
const EXTENSIONS = { zip: "zip", json: "json" };

export async function createUploadUrl(ctx, format = "zip") {
  const ext = EXTENSIONS[format];
  if (!ext) throw new Error(`Unsupported format: ${format} (expected zip or json)`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `uploads/export-${stamp}.${ext}`;
  const url = await getSignedUrl(
    ctx.s3,
    new PutObjectCommand({ Bucket: ctx.bucket, Key: key }),
    { expiresIn: EXPIRES_SECONDS }
  );
  return { upload_url: url, key, format, expires_in_seconds: EXPIRES_SECONDS };
}

export const requestUploadUrl = {
  name: "request_upload_url",
  description:
    "Generate a pre-signed S3 URL for uploading a health export. Supports the " +
    "Apple Health export ZIP (format \"zip\", default) and the Health Auto " +
    "Export JSON feed (format \"json\"). The user PUTs the file to the returned " +
    "URL (valid 15 minutes); parsing starts automatically after upload and " +
    "takes a minute or two.",
  inputSchema: {
    type: "object",
    properties: {
      format: {
        type: "string",
        enum: ["zip", "json"],
        description:
          'Upload format: "zip" for the Apple Health export, "json" for the ' +
          "Health Auto Export feed. Defaults to zip.",
      },
    },
    additionalProperties: false,
  },

  async handler(args = {}, ctx) {
    const format = args.format ?? "zip";
    const result = await createUploadUrl(ctx, format);
    const fileHint =
      format === "json"
        ? "the Health Auto Export JSON file"
        : "the apple_health_export.zip";
    return {
      ...result,
      instructions:
        `Upload ${fileHint} with an HTTP PUT to upload_url ` +
        `within ${result.expires_in_seconds / 60} minutes. On iPhone, use the ` +
        "Health Sync Shortcut or the Files app share sheet. Parsing runs " +
        "automatically once the upload completes; check get_sync_status afterwards.",
    };
  },
};
