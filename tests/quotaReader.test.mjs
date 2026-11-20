import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseAgyUsageJson } from '../dist-electron/main/quotaReader.js';

describe('parseAgyUsageJson', () => {
  it('parses valid agy /usage JSON output accurately without rounding drift', () => {
    const sample = JSON.stringify({
      conversation_id: '',
      status: 'SUCCESS',
      command: {
        name: 'usage',
        data: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [
                {
                  id: 'gemini-weekly',
                  window: 'weekly',
                  remaining_fraction: 0.5507717132568359,
                  reset_time: '2026-11-21T00:47:25Z',
                },
                {
                  id: 'gemini-5h',
                  window: '5h',
                  remaining_fraction: 0.9546318054199219,
                  reset_time: '2026-11-16T12:19:26Z',
                },
              ],
            },
            {
              name: 'Claude and GPT models',
              buckets: [
                {
                  id: '3p-weekly',
                  window: 'weekly',
                  remaining_fraction: 0.18009187281131744,
                  reset_time: '2026-11-18T08:25:02Z',
                },
                {
                  id: '3p-5h',
                  window: '5h',
                  remaining_fraction: 1,
                  reset_time: '2026-11-16T12:49:25Z',
                },
              ],
            },
          ],
        },
      },
    });

    const parsed = parseAgyUsageJson(sample, Date.parse('2026-11-16T07:50:00.000Z'));
    assert.equal(parsed.status, 'ok');
    assert.equal(parsed.gemini.weeklyRemainingPct, 55);
    assert.equal(parsed.gemini.fiveHourRemainingPct, 95);
    assert.equal(parsed.gemini.weeklyResetAt, '2026-11-21T00:47:25Z');
    assert.equal(parsed.thirdParty.weeklyRemainingPct, 18);
    assert.equal(parsed.thirdParty.fiveHourRemainingPct, 100);
    assert.equal(parsed.thirdParty.weeklyResetAt, '2026-11-18T08:25:02Z');
  });

  it('supports 0% and 100% boundaries faithfully', () => {
    const zeroPayload = JSON.stringify({
      status: 'SUCCESS',
      command: {
        name: 'usage',
        data: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [{ id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0 }],
            },
            {
              name: 'Claude and GPT models',
              buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: 1 }],
            },
          ],
        },
      },
    });

    const parsed = parseAgyUsageJson(zeroPayload, 1_000_000);
    assert.equal(parsed.status, 'ok');
    assert.equal(parsed.gemini.weeklyRemainingPct, 0);
    assert.equal(parsed.gemini.fiveHourRemainingPct, null);
    assert.equal(parsed.thirdParty.weeklyRemainingPct, 100);
  });

  it('fails explicitly on invalid JSON, non-SUCCESS status, or missing buckets instead of guessing 0%', () => {
    assert.equal(parseAgyUsageJson('').status, 'error');
    assert.equal(parseAgyUsageJson('not-json').status, 'error');
    assert.equal(
      parseAgyUsageJson(JSON.stringify({ status: 'FAILED', command: { name: 'usage' } })).status,
      'error'
    );
    assert.equal(
      parseAgyUsageJson(
        JSON.stringify({
          status: 'SUCCESS',
          command: {
            name: 'usage',
            data: {
              groups: [{ name: 'Gemini Models', buckets: [] }],
            },
          },
        })
      ).status,
      'error'
    );
  });
});
