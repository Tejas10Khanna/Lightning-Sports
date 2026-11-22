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

Prepare a brief from a selected lead. Check its sources and record two or more
distinct facts in your own words. Include only material permitted for transfer
to the model provider under your account terms. Google's unpaid service may
use submitted material to improve its products. See the
[Gemini API terms](https://aistudio.google.com/docs/terms#unpaid-services).

Save the brief as the Actions secret `NEWSROOM_WRITER_BRIEF`. This fictional
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

Set `NEWSROOM_GEMINI_API_KEY` as a separate Actions secret and reuse
`NEWSROOM_REPORT_KEY`. On `main`, choose **draft** in **Newsroom intake**.
Each dispatch requests one draft from Gemini 3.1 Flash-Lite and uploads
`draft.enc` for three days. Use the same decrypt command with `draft.enc`.
Eligibility for the Gemini free tier depends on the associated API project.

The Cricket and Football profiles require a thesis, reporting, analysis, and a
counterargument, with an evidence reference on each paragraph. The private
packet includes an AI-assistance flag and the Lightning Sports Desk byline.
Check every claim, the headline, and the counterargument against the source
before approval. Reference validation only confirms that cited notes exist.
A brief that lacks enough evidence can produce a hold packet with the gaps
listed. Drafting runs on demand and has no publishing step.

## Test

```sh
npm ci --prefix newsroom --ignore-scripts --no-audit --no-fund
npm test --prefix newsroom
```
