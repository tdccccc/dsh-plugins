import test from 'node:test';
import assert from 'node:assert/strict';
import { recentSessions, sessionWindowMinutes } from '../lib/sessions.js';

test('a write inside the window blocks the restart', () => {
  const summary = recentSessions({
    sessions: { dir: '~/.dsh/sessions', window: 10, active: 2, files: 5, latestAge: 3, ids: ['session-a', 'session-b'] },
  }, 10);
  assert.deepEqual(summary, {
    active: 2, files: 5, window: 10, latestAge: 3, ids: ['session-a', 'session-b'],
  });
});

test('an idle or missing store does not block', () => {
  assert.equal(recentSessions({ sessions: { active: 0, files: 0 } }, 10), null);
  assert.equal(recentSessions({ sessions: null }, 10), null);
  assert.equal(recentSessions({}, 10), null);
  assert.equal(recentSessions(null, 10), null);
});

test('the summary is sanitized and capped', () => {
  const summary = recentSessions({
    sessions: { active: 3, files: -1, window: 0, latestAge: null, ids: ['a', '', 7, 'b', 'c'] },
  }, 15);
  assert.deepEqual(summary, { active: 3, files: 0, window: 15, latestAge: null, ids: ['a', 'b'] });
});

test('the session window falls back to ten minutes', () => {
  assert.equal(sessionWindowMinutes({}), 10);
  assert.equal(sessionWindowMinutes({ sessionWindow: 30 }), 30);
  assert.equal(sessionWindowMinutes({ sessionWindow: 0 }), 10);
  assert.equal(sessionWindowMinutes({ sessionWindow: 5000 }), 10);
  assert.equal(sessionWindowMinutes({ sessionWindow: { get: () => 20 } }), 20);
});
