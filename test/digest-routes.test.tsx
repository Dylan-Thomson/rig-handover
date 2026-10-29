import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const GOOD_LINES = [
  '{"at":"2026-10-28T23:00:02+01:00","job":"rig/rotate-logs","status":"ok","owner":"lane-07"}',
  '{"at":"2026-10-28T23:00:06+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2026-10-28T23:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
  '{"at":"2026-10-28T23:31:00+01:00","job":"fixtures/refresh","status":"fail","owner":null,"error":"upstream 503"}',
  '{"at":"2026-10-28T23:45:00+01:00","job":"digest/render","status":"ok","owner":null}',
];

const GOOD_JOBS = ['digest/render', 'fixtures/refresh', 'lane/sync', 'rig/rotate-logs'];

let runsDir: string;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  writeFileSync(join(runsDir, '2026-10-28.jsonl'), `${GOOD_LINES.join('\n')}\n`);
  writeFileSync(join(runsDir, '2026-10-29.jsonl'), [GOOD_LINES[0], 'this is not json', GOOD_LINES[1], ''].join('\n'));
  writeFileSync(join(runsDir, '2026-10-30.jsonl'), '');
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function app() {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
}

function jobsInOrder(html: string, jobs: readonly string[]): number[] {
  return jobs.map((job) => html.indexOf(job));
}

describe('GET /digest/:night', () => {
  it('returns 200 and every job name in the table', async () => {
    const res = await app().request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const job of GOOD_JOBS) expect(html).toContain(job);
  });

  it('returns 404 for a night with no file', async () => {
    const res = await app().request('/digest/2026-01-01');
    expect(res.status).toBe(404);
  });

  it('returns 200 and says nothing ran for an empty file', async () => {
    const res = await app().request('/digest/2026-10-30');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('returns 200 and renders the good jobs when a line is bad', async () => {
    const res = await app().request('/digest/2026-10-29');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('rig/rotate-logs');
    expect(html).toContain('lane/sync');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns 200 with night, rows and badLines, rows sorted by job', async () => {
    const res = await app().request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.night).toBe('2026-10-28');
    expect(body.badLines).toBe(0);
    expect(body.rows.map((row) => row.job)).toEqual(GOOD_JOBS);
  });

  it('returns 404 for a night with no file', async () => {
    const res = await app().request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
  });

  it('returns no rows and zero bad lines for an empty file', async () => {
    const res = await app().request('/api/digest/2026-10-30');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: '2026-10-30', rows: [], badLines: 0 });
  });

  it('counts the bad line and still returns the good rows', async () => {
    const res = await app().request('/api/digest/2026-10-29');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((row) => row.job)).toEqual(['lane/sync', 'rig/rotate-logs']);
  });
});

describe('page and JSON agree', () => {
  it('lists the same jobs in the same order for the same night', async () => {
    const server = app();
    const pageRes = await server.request('/digest/2026-10-28');
    const jsonRes = await server.request('/api/digest/2026-10-28');
    expect(pageRes.status).toBe(200);
    expect(jsonRes.status).toBe(200);
    const html = await pageRes.text();
    const body = (await jsonRes.json()) as Night;
    const jobs = body.rows.map((row) => row.job);
    const positions = jobsInOrder(html, jobs);
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
