import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunLine, RunStatus } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function parseLine(line: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.at !== 'string' || typeof v.job !== 'string') return null;
  if (!STATUSES.includes(v.status as RunStatus)) return null;
  if (v.owner !== null && typeof v.owner !== 'string') return null;
  if (v.error !== undefined && typeof v.error !== 'string') return null;
  return { at: v.at, job: v.job, status: v.status as RunStatus, owner: v.owner, error: v.error };
}

function addRun(row: DigestRow | undefined, line: RunLine): DigestRow {
  const isRetry = line.status === 'retry' ? 1 : 0;
  if (!row) {
    return {
      job: line.job,
      owner: line.owner,
      runs: 1,
      retries: isRetry,
      lastStatus: line.status,
      lastError: line.error ?? null,
      firstAt: line.at,
      lastAt: line.at,
    };
  }
  return {
    ...row,
    owner: line.owner ?? row.owner,
    runs: row.runs + 1,
    retries: row.retries + isRetry,
    lastStatus: line.status,
    lastError: line.error ?? row.lastError,
    lastAt: line.at,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }

  const rows = new Map<string, DigestRow>();
  let badLines = 0;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (!line) {
      badLines += 1;
      continue;
    }
    rows.set(line.job, addRun(rows.get(line.job), line));
  }

  return {
    night,
    rows: [...rows.values()].sort((a, b) => a.job.localeCompare(b.job)),
    badLines,
  };
};

export type StatusCounts = Record<RunStatus, number>;

// Run lines per status for one night, null when the file is missing. Unparseable lines are skipped.
export function countStatuses(runsDir: string, night: string): StatusCounts | null {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  for (const raw of text.split('\n')) {
    const line = parseLine(raw);
    if (line) counts[line.status] += 1;
  }
  return counts;
}
