# iOS Shortcut: "Health Sync"

One-tap upload of the Apple Health export ZIP from the iPhone Share Sheet.

## Prerequisites

- The bearer token from `terraform output -raw auth_token` (fetch once after deploy)
- The API endpoint from `terraform output api_endpoint`

The upload URL endpoint is:
```
https://<api-id>.execute-api.eu-central-1.amazonaws.com/upload-url
```

## Build steps

1. Open the **Shortcuts** app → **+** (new shortcut)
2. Rename it to `Health Sync`
3. Tap **ⓘ** → enable **Show in Share Sheet**, accepted types: **Files** only
4. Add these actions in order:

   | # | Action | Configuration |
   |---|--------|---------------|
   | 1 | **Text** | Your bearer token (from `terraform output -raw auth_token`) — name this variable `Token` |
   | 2 | **Get Contents of URL** | URL: `https://<api-id>.execute-api.eu-central-1.amazonaws.com/upload-url`. Method: **GET**. Add header: `Authorization` = `Bearer [Token variable]` |
   | 3 | **Get Dictionary Value** | Key: `upload_url`, from **Contents of URL** |
   | 4 | **Get Contents of URL** | URL: **Dictionary Value** (step 3). Method: **PUT**. Request Body: **File** → **Shortcut Input** |
   | 5 | **Show Notification** | "Health data uploaded — parsing starts automatically" |

5. Done.

## Daily flow

1. **Health app** → profile → **Export All Health Data** → Share → save to **Files**
2. In **Files**, long-press `apple_health_export.zip` → **Share** → **Health Sync**
3. Wait for the notification (~5 seconds for the upload; parsing takes 1–3 minutes)
4. Ask Claude: *"What's my sync status?"* to confirm

## Notes

- The pre-signed S3 URL from step 2 is valid for **15 minutes**
- Uploads expire from S3 after **7 days** automatically
- If the upload fails, re-run the shortcut (the pre-signed URL may have expired mid-transfer on a slow connection)
