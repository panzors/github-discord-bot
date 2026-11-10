'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { logsLink } = require('../src/functions/appInsightsAlert');

const rid = '/subscriptions/s/resourceGroups/rg/providers/microsoft.insights/components/app';

test('prefers the filtered UI link from Log Alerts V2', () => {
  const data = { alertContext: { condition: { allOf: [{ linkToSearchResultsUI: 'all', linkToFilteredSearchResultsUI: 'filtered' }] } } };
  assert.strictEqual(logsLink(data), 'filtered');
});

test('reads legacy top-level LinkToSearchResultsUI', () => {
  assert.strictEqual(logsLink({ alertContext: { LinkToSearchResultsUI: 'legacy' } }), 'legacy');
});

test('builds a link from query + window when no link is sent', () => {
  const data = {
    essentials: { alertTargetIDs: [rid] },
    alertContext: { condition: {
      windowSize: 'PT5M',
      windowStartTime: '2026-11-10T10:00:00.000Z',
      windowEndTime: '2026-11-10T10:00:00.000Z',
      allOf: [{ searchQuery: 'exceptions | take 10' }],
    } },
  };
  const url = logsLink(data);
  assert.ok(url.includes(`/resourceId/${encodeURIComponent(rid)}/`));
  assert.ok(url.includes(`/query/${encodeURIComponent('exceptions | take 10')}/`));
  assert.ok(url.endsWith(encodeURIComponent('2026-11-10T09:55:00.000Z/2026-11-10T10:00:00.000Z')));
});

test('returns null for metric alerts with nothing to query', () => {
  assert.strictEqual(logsLink({ essentials: {}, alertContext: { condition: { allOf: [{ metricName: 'x' }] } } }), null);
});
