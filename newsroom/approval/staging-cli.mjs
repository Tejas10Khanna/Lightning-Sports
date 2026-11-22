import { runStagingCheck } from './staging.mjs';
import { reviewService } from './submit.mjs';

try {
  const env = process.env;
  const outcome = await runStagingCheck({
    scenario: env.NEWSROOM_STAGING_SCENARIO,
    runKey: env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT,
    service: reviewService({ url: env.NEWSROOM_APPROVAL_URL, token: env.NEWSROOM_INTAKE_TOKEN }),
  });
  console.log('Telegram staging check passed with outcome %s.', outcome);
} catch (error) {
  const safe = /^(Invalid Telegram staging scenario|Telegram (did not|review service)|The (staging review|review expired))/;
  console.error(safe.test(error.message) ? error.message : 'The Telegram staging request failed.');
  process.exitCode = 1;
}
