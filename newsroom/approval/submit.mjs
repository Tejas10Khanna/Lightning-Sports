export async function sendForReview(packet, { url, token, request = fetch }) {
  if (packet.status === 'insufficient-evidence') return 'insufficient-evidence';
  if (!url || !token) throw new Error('Telegram review service URL and intake token are required.');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('Telegram review service URL must use HTTPS.');
  }
  const response = await request(new URL('/reviews', endpoint), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', 'x-newsroom-intake-token': token },
    body: JSON.stringify(packet),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Telegram review service returned HTTP ' + response.status + '.');
  }
  const { status } = await response.json();
  if (!['awaiting-decision', 'manual-review', 'approved', 'needs-edit', 'rejected',
    'committed', 'published', 'committed-unverified'].includes(status)) {
    throw new Error('Telegram review service has not confirmed delivery.');
  }
  return status;
}
