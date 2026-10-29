import type { DigestRow } from './types.js';

export const RETRY_WARN_AT = 3;

export function isWarn(row: DigestRow): boolean {
  return row.retries >= RETRY_WARN_AT || row.lastStatus === 'fail';
}
