# iOS Shortcut: "Health Sync"

One-tap upload of the Apple Health export ZIP from the iPhone Share Sheet.
You build it once in the Shortcuts app (~2 minutes).

## Prerequisites

- The API endpoint and auth token (see [claude-connector.md](claude-connector.md)
  for how to fetch them). You need this URL:

  ```
  https://<api-id>.execute-api.eu-central-1.amazonaws.com/upload-url/<TOKEN>
  ```

## Build steps

1. Open the **Shortcuts** app → **+** (new shortcut).
2. Tap the shortcut name → **Rename** → call it `Health Sync`.
3. Tap the info button (ⓘ) → enable **Show in Share Sheet**.
   Set accepted types to **Files** only.
4. Add the actions below in order:

   | # | Action | Configuration |
   |---|--------|---------------|
   | 1 | **Get Contents of URL** | URL: your `/upload-url/<TOKEN>` endpoint. Method: **GET** |
   | 2 | **Get Dictionary Value** | Get **Value** for key `upload_url` in **Contents of URL** |
   | 3 | **Get Contents of URL** | URL: **Dictionary Value** (from step 2). Method: **PUT**. Request Body: **File** → select **Shortcut Input** |
   | 4 | **Show Notification** | "Health data uploaded — parsing starts automatically" |

5. Done.

## Daily flow

1. **Health app** → profile picture → **Export All Health Data** → wait → **Share**
   → save to **Files** (or share directly to the Shortcut if offered).
2. In **Files**, long-press `apple_health_export.zip` → **Share** → **Health Sync**.
3. Wait for the notification. Parsing takes 1–3 minutes depending on export size.
4. Ask Claude: *"What's my sync status?"* to confirm.

## Notes

- The pre-signed URL from step 1 is valid for **15 minutes** — plenty, since the
  shortcut PUTs immediately.
- Uploads land in S3 under `uploads/` and are deleted automatically after 7 days.
- If the upload fails with a signature error, re-run the shortcut (the URL may
  have expired while the file was transferring on a slow connection).
