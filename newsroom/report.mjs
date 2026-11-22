import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const algorithm = 'aes-256-gcm';
const header = Buffer.from('LSNR1');
const nonceLength = 12;
const tagLength = 16;

export function readReportKey(value) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value ?? '')) {
    throw new Error('NEWSROOM_REPORT_KEY must be a base64-encoded 32-byte key.');
  }
  return Buffer.from(value, 'base64');
}

export function encryptReport(report, key) {
  const nonce = randomBytes(nonceLength);
  const cipher = createCipheriv(algorithm, key, nonce, { authTagLength: tagLength });
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(JSON.stringify(report, null, 2)), cipher.final()]);
  return Buffer.concat([header, nonce, cipher.getAuthTag(), body]);
}

export function decryptReport(bytes, key) {
  const tagStart = header.length + nonceLength;
  const bodyStart = tagStart + tagLength;
  if (bytes.length <= bodyStart || !bytes.subarray(0, header.length).equals(header)) {
    throw new Error('Invalid newsroom report.');
  }
  const decipher = createDecipheriv(algorithm, key, bytes.subarray(header.length, tagStart), {
    authTagLength: tagLength,
  });
  decipher.setAAD(header);
  decipher.setAuthTag(bytes.subarray(tagStart, bodyStart));
  return Buffer.concat([decipher.update(bytes.subarray(bodyStart)), decipher.final()]);
}
