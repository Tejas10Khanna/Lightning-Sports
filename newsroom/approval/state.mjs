export const reviewWindowMs = 5 * 60_000;

export function attachDelivery(review, messageId, now) {
  return {
    ...review,
    messageId,
    status: 'awaiting-decision',
    deliveredAt: now,
    deadline: now + reviewWindowMs,
  };
}

export function decide(review, { action, messageId, now }) {
  if (review.messageId !== messageId ||
      !['awaiting-decision', 'manual-review'].includes(review.status)) return review;
  if (action === 'edit') return { ...review, status: 'needs-edit', decidedAt: now };
  if (action === 'reject') return { ...review, status: 'rejected', decidedAt: now };
  if (action === 'approve' && review.factCheckPassed) {
    return { ...review, status: 'approved', decidedAt: now, decision: 'editor' };
  }
  return review;
}

export function expireReview(review, now, autoPublishEnabled = false) {
  if (review.status !== 'awaiting-decision' || now < review.deadline) return review;
  if (autoPublishEnabled && review.independentlyVerified && review.factCheckPassed && !review.testOnly) {
    return { ...review, status: 'approved', decidedAt: now, decision: 'verified-timeout' };
  }
  return { ...review, status: 'manual-review', expiredAt: now };
}
