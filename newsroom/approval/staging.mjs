import { setTimeout } from 'node:timers/promises';
import { expectedStageStatus } from './staging-packet.mjs';
import { reviewWindowMs } from './state.mjs';

export async function runStagingCheck({
  scenario, runKey, service, now = Date.now, pause = setTimeout, log = console.log,
}) {
  const expected = expectedStageStatus[scenario];
  if (!Object.hasOwn(expectedStageStatus, scenario)) throw new Error('Invalid Telegram staging scenario.');
  const result = await service('/staging-reviews', { runKey, scenario });
  if (typeof result?.revision !== 'string' || !/^[0-9a-f]{32}$/.test(result.revision) ||
      !['awaiting-decision', expected].includes(result.status)) {
    throw new Error('Telegram did not confirm staging delivery.');
  }
  log(scenario === 'timeout'
    ? 'Staging draft sent. Leave its buttons untouched to verify the five-minute deadline.'
    : 'Staging draft sent. Tap the requested button in your private Telegram chat.');

  const stopAt = now() + 420_000;
  while (now() <= stopAt) {
    const state = await service('/reviews/' + result.revision);
    if (state.testOnly !== true || !Number.isSafeInteger(state.deliveredAt) ||
        state.deadline !== state.deliveredAt + reviewWindowMs) {
      throw new Error('The staging review did not record a valid five-minute window.');
    }
    if (state.status === expected) {
      if (scenario === 'timeout' && (!Number.isSafeInteger(state.expiredAt) || state.expiredAt < state.deadline)) {
        throw new Error('The review expired before its deadline.');
      }
      return expected;
    }
    if (state.status !== 'awaiting-decision') throw new Error('The staging review reached a different outcome.');
    await pause(12_000);
  }
  throw new Error('The staging review did not reach the expected outcome in seven minutes.');
}

