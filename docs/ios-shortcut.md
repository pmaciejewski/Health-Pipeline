# iOS Shortcut: "Health Sync"

One-tap upload of the [Health Auto Export](https://www.healthexportapp.com/)
JSON file from the iPhone Share Sheet. You build it once in the Shortcuts app
(~2 minutes). The Health Auto Export app can also PUT to the upload URL directly
via its built-in automation/REST export — the shortcut is just the manual path.

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
   Set **Accepted Types** to **Files** (turn the rest off).
4. Add the actions below in order:

   | # | Action | Configuration |
   |---|--------|---------------|
   | 1 | **Get Contents of URL** | URL: your `/upload-url/<TOKEN>` endpoint. Method: **GET** |
   | 2 | **Get Dictionary Value** | Get **Value** for key `upload_url` in **Contents of URL** |
   | 3 | **Get Contents of URL** | URL: **Dictionary Value** (from step 2). Method: **PUT**. **Request Body: File**, and set the file to the **Shortcut Input** variable |
   | 4 | **Show Notification** | "Health data uploaded — parsing starts automatically" |

5. Done.

> ⚠️ **The #1 cause of an empty upload** (sync status error
> *"Empty object … the upload has no body"*) is action #3's body. Tap **Show
> More** on that action and confirm **Request Body** is set to **File** — if it
> is left on **JSON** or **Form**, the PUT sends no file and S3 stores a 0-byte
> object. Then make sure the body's file is the **Shortcut Input** (the shared
> `.json`), not the *Dictionary Value* from step 2 (that's only the URL).

## Daily flow

1. In **Health Auto Export**, export the metrics you want as **JSON** and
   **Share** the file.
2. Pick **Health Sync** from the Share Sheet (or, in **Files**, long-press the
   exported `.json` → **Share** → **Health Sync**). Always launch it **from the
   Share Sheet on the file** — running it from inside the Shortcuts app gives it
   no input, which also produces an empty upload.
3. Wait for the notification. Parsing takes a minute or two.
4. Ask Claude: *"What's my sync status?"* to confirm (`format: json`, with a
   non-zero `days_written`).

## Verifying outside the Shortcut

To prove the endpoint and parser work independently of the Shortcut, upload the
file by hand:

```bash
# Ask Claude "request an upload URL" and copy the upload_url, then:
curl -T HealthAutoExport.json "<upload_url>"
```

`curl -T` sends the file as the PUT body. After it returns, check the sync
status in Claude.

## Notes

- The pre-signed URL is valid for **15 minutes** — plenty, since the shortcut
  PUTs immediately.
- The object key's extension does not matter; whatever is uploaded is parsed as
  the Health Auto Export JSON feed.
- Uploads land in S3 under `uploads/` and are deleted automatically after 7 days.
- If the upload fails with a signature error, re-run the shortcut (the URL may
  have expired while the file was transferring on a slow connection).
