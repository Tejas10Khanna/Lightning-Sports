export function reviewService({ url, token, request = fetch }) {
  if (!url || !token) throw new Error('Telegram review service URL and intake token are required.');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('Telegram review service URL must use HTTPS.');
  }
  return async (path, payload) => {
    const response = await request(new URL(path, endpoint), {
      method: payload === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', 'x-newsroom-intake-token': token },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Telegram review service returned HTTP ' + response.status + '.');
    }
    return response.json();
  };
}

export async function sendForReview(packet, options) {
  if (packet.status === 'insufficient-evidence') return 'insufficient-evidence';
  const { status } = await reviewService(options)('/reviews', packet);
  if (!['awaiting-decision', 'manual-review', 'approved', 'needs-edit', 'rejected',
    'committed', 'published', 'committed-unverified'].includes(status)) {
    throw new Error('Telegram review service has not confirmed delivery.');
  }
  return status;
}
