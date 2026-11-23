# Newsroom intake pilot

This job collects and ranks Cricket and Football leads for a human editor. Its
output is a review packet with working headlines, URLs, timing, and source
permissions. Every candidate requires human verification.

## Configure approved feeds

Add a repository Actions secret named `NEWSROOM_SOURCES` with an array of
approved RSS 2.0 or Atom sources. The example below uses a placeholder.

```json
[
  {
    "id": "example-cricket",
    "organization": "example-league",
    "sport": "Cricket",
    "role": "primary",
    "feedUrl": "https://cricket.example/feed.xml",
    "articleHosts": ["cricket.example"],
    "permissionUrl": "https://cricket.example/terms"
  }
]
```

Use the final HTTPS feed URL and list only the exact hostnames that may appear
in article links. Use a shared `organization` value for sibling feeds and
syndicated material from the same origin. Supported roles are `primary` and
`reporting`. Confirm that terms allow automated intake and private retention
of the feed's title, link, and date for this use. Keep a dated record of any
individual permission separately. The example includes no preapproved feeds.

Generate a private key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
Save it in your password manager and as the repository Actions secret
`NEWSROOM_REPORT_KEY`. Keep the same key while you want continuity across runs.

## Run and read a review

On `main`, choose **intake** when running **Newsroom intake** after setting both secrets. Enable
hourly collection by setting the Actions variable `NEWSROOM_ENABLED` to
`true`. It is scheduled at minute 17. Clear the variable to pause scheduling.

Download the run's artifact and extract `review.enc`. Set `NEWSROOM_REPORT_KEY`
in your local environment from your password manager and run the following
from the repository root. Choose a private destination for the JSON.

```sh
node newsroom/run.mjs decrypt review.enc newsroom/state/review.json
```

The command creates the destination directory and refuses to overwrite an
existing file. The workflow logs aggregate counts and retains the encrypted
packet for three days. Only keyed fingerprints and timestamps go into the
Actions cache. Cache eviction or key rotation can cause repeated leads.

The reviewer considers source role, number of distinct organizations, and
freshness. It removes repeated URLs and normalized headlines, and compares
headlines against the existing Astro article slugs. Differently worded
coverage can still require manual deduplication. A feed error is recorded in the
private packet. When all feeds fail, the run fails visibly.

## Draft one editorial

To bind a brief to a collected lead locally, use
`node newsroom/run.mjs draft-from-lead <review.enc> <lead-id>` with the existing
brief, Groq, and report-key environment variables. Copy `leadId` from the
decrypted report. The brief must match the lead's sport and cite at least one
listed source. Editors can include additional corroborating sources.

Prepare a brief from a selected lead. Check its sources and record two or more
distinct facts in your own words. Include only material permitted for transfer
to the model provider under your account terms. Review [Groq’s data controls](https://console.groq.com/docs/your-data) for retention settings.

For a brief containing only public facts and URLs, paste its JSON into the
`public_brief` field when dispatching the draft stage. On this public repository,
treat workflow inputs as public. For a private brief, leave that field empty and
save the JSON as the Actions secret `NEWSROOM_WRITER_BRIEF`. This fictional
example shows the required fields.

```json
{
  "sport": "Cricket",
  "topic": "What changed after the powerplay in the Example Cup final?",
  "modelUseApproved": true,
  "evidence": [
    { "fact": "The chasing side scored 50 for 0 in the first six overs.", "url": "https://cup.example/scorecard" },
    { "fact": "Spin bowlers took three wickets across the next four overs.", "url": "https://cup.example/scorecard" }
  ]
}
```

Set `NEWSROOM_GROQ_API_KEY` as a separate Actions secret and reuse
`NEWSROOM_REPORT_KEY`. On `main`, choose **draft** in **Newsroom intake**.
Each dispatch requests one draft from GPT-OSS 120B on Groq, then checks that
draft with a separate model call. It uploads
`draft.enc` for three days. Use the same decrypt command with `draft.enc`.
Check the Groq console for the API project’s current limits.

The Cricket and Football profiles require a thesis, reporting, analysis, and a
counterargument, with an evidence reference on each paragraph. The private
packet includes an AI-assistance flag and the Lightning Sports Desk byline.
The fact check compares the headline, dek, and every paragraph against the
supplied notes. Missing support, contradictions, and sensitive material hold
the draft for editorial review. Open the linked sources and independently
verify the claims and interpretation before approval. Drafting runs on demand.

## Telegram staging

The review service is a Cloudflare Worker with SQLite-backed Durable Objects.
Use a dedicated Telegram bot, start a private chat with it, and configure the
Worker using the values below. Store tokens through Cloudflare's secret
settings and keep them out of source code, logs, and chat.

For the first deployment, use **Workers & Pages → Create application →
GitHub**. Grant repository access to `Tejas10Khanna/Lightning-Sports` and
configure the Worker before deploying.

| Cloudflare setting | Value |
| --- | --- |
| Worker name | `lightning-sports-editorial-review` |
| Branch | `codex/newsroom-supervised-publishing` |
| Root directory | `newsroom/approval` |
| Build command | Leave blank |
| Deploy command | `npx --yes wrangler@4.166.0 deploy` |

Use the assigned `workers.dev` URL for staging. Wrangler preserves variables
configured in the Worker dashboard on future deploys. The Cloudflare build
environment and the Worker runtime settings have separate uses. Add Telegram
secrets to the Worker runtime settings.

The setup helper can find the private editor and chat IDs before the webhook
is active. Run `node newsroom/approval/telegram-setup.mjs discover` in a private
terminal with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_EXPECTED_BOT` in the process
environment. The expected bot value is its public username. If the pending
update has expired, send `/start` again. Keep the IDs in your configuration.

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `NEWSROOM_INTAKE_TOKEN`
  are Worker secrets.
- `TELEGRAM_CHAT_ID` and `TELEGRAM_EDITOR_ID` identify the authorized private
  chat and editor. Keep the values as strings in the Worker environment.
- Register the Telegram webhook at the Worker URL ending in `/telegram` with
  the same webhook secret. Set `NEWSROOM_APPROVAL_URL` to the Worker base URL
  and supply `TELEGRAM_WEBHOOK_SECRET` in the same private environment. Run
  `node newsroom/approval/telegram-setup.mjs connect`. The helper registers
  only `callback_query` updates and checks Telegram's confirmed URL. It
  refuses to replace a webhook pointing to another destination.
- In GitHub Actions, set `NEWSROOM_APPROVAL_URL` to the Worker base URL and
  add the same `NEWSROOM_INTAKE_TOKEN` as an Actions secret. Without the URL,
  the draft workflow only uploads the encrypted review.

Bundle locally for a configuration check with
`npx --yes wrangler@4.166.0 deploy --dry-run --config newsroom/approval/wrangler.toml`.

The bot sends the article and source links as a protected attachment. Approve
records the editor's sign-off. Edit closes that revision and requests a new
draft. Reject closes the review. The five-minute window starts after Telegram
confirms delivery. Unanswered reviews move to manual review, and drafts with
fact-check issues offer Edit and Reject.

### Run the live Telegram checks

After deploying the Worker and registering the webhook, set the Worker
variable `NEWSROOM_STAGING_ENABLED` to the string `true`. In **Newsroom intake**
on `main`, choose **telegram-test** and one of **approve**, **edit**, **reject**,
or **timeout**. The bot sends a clearly marked fictional draft for each run.
Follow the instruction in its caption. For the timeout test, leave the buttons
untouched for five minutes.

The workflow verifies that the Worker recorded the selected outcome and
measured the five-minute window from confirmed delivery. These tests use the
Worker URL and intake token. They require neither feed access nor a Groq
key. The Worker excludes fictional drafts from publishing even if publishing
is enabled. Clear `NEWSROOM_STAGING_ENABLED` after the checks.

## GitHub publishing

Keep `NEWSROOM_PUBLISH_ENABLED` unset during staging. Test all three buttons
and a full timeout, then review a draft and confirm that the article contract
from PR #1 is on `main`. Only after the supervised test should you add a
repository-scoped GitHub publisher token with Contents write permission as
`NEWSROOM_GITHUB_TOKEN` and explicitly turn publishing on in the Worker.
Check the production branch protection and Vercel deployment permissions
for the publishing identity first.

With publishing enabled, an explicit, eligible approval creates one Markdown
file under `src/content/posts/` and checks its public URL. The publisher never
overwrites an existing file. The Worker checks the live URL for up to 15
minutes after the commit. GitHub writes and live-site verification require a
supervised real run. Timeout publication requires an independent evidence
and rights gate and is disabled in this pilot.

## Test

```sh
npm ci --prefix newsroom --ignore-scripts --no-audit --no-fund
npm test --prefix newsroom
```
