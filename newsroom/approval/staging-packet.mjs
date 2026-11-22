export const expectedStageStatus = Object.freeze({
  approve: 'approved',
  edit: 'needs-edit',
  reject: 'rejected',
  timeout: 'manual-review',
});

export function stagingPacket(runKey, scenario) {
  if (typeof runKey !== 'string' || !/^\d{1,24}-\d{1,5}$/.test(runKey) ||
      typeof scenario !== 'string' || !Object.hasOwn(expectedStageStatus, scenario)) return null;
  const instructions = scenario === 'timeout'
    ? 'Leave the buttons untouched for five minutes.'
    : 'Tap ' + scenario[0].toUpperCase() + scenario.slice(1) + ' to complete this test.';
  const paragraphs = [
    { kind: 'reporting', text: 'The fictional home side scored a goal after 75 minutes.', evidenceIds: ['E1'] },
    { kind: 'analysis', text: 'The late goal illustrates how game state can shape the response.', evidenceIds: ['E1', 'E2'] },
    { kind: 'counterargument', text: 'One fictional example cannot establish a trend.', evidenceIds: ['E2'] },
    { kind: 'analysis', text: 'This sample is for testing the editorial review controls.', evidenceIds: ['E2'] },
  ];
  return {
    testOnly: true,
    status: 'needs-human-verification',
    sport: 'Football',
    headline: 'STAGING ONLY · ' + scenario + ' · run ' + runKey,
    dek: instructions,
    paragraphs,
    evidence: [
      { id: 'E1', url: 'https://football.example/test-timeline' },
      { id: 'E2', url: 'https://football.example/test-scorecard' },
    ],
    factCheck: {
      scope: 'supplied-evidence',
      risk: 'routine',
      checks: ['headline', 'dek', ...paragraphs.map((_, index) => 'paragraph-' + (index + 1))]
        .map((unitId) => ({ unitId, verdict: 'supported', explanation: 'Synthetic fixture for staging.' })),
    },
  };
}
