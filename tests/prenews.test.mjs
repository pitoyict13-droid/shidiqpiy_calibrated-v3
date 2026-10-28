import assert from 'node:assert/strict';
import { updatePreNewsStore } from '../scripts/fetch-calendar.mjs';

const now = Date.parse('2026-10-28T00:00:00Z');
const soon = new Date(now + 10 * 60 * 1000).toISOString();
const later = new Date(now + 2 * 60 * 60 * 1000).toISOString();
const passed = new Date(now - 60 * 1000).toISOString();

const events = [
  { Date: soon, Event: 'CPI', Importance: 3 },
  { Date: soon, Event: 'Low impact', Importance: 1 },
  { Date: later, Event: 'Later', Importance: 3 },
  { Date: passed, Event: 'Already out', Importance: 3 },
];

const store = updatePreNewsStore({}, events, 4000, now);
assert.equal(store[`${soon}|CPI`].price, 4000);
assert.equal(store[`${soon}|CPI`].capturedAt, new Date(now).toISOString());
assert.equal(store[`${soon}|Low impact`], undefined);
assert.equal(store[`${later}|Later`], undefined);
assert.equal(store[`${passed}|Already out`], undefined);

const refreshed = updatePreNewsStore({ [`${soon}|CPI`]: { price: 3980, capturedAt: new Date(now - 5 * 60 * 1000).toISOString() } }, events, 4000, now);
assert.equal(refreshed[`${soon}|CPI`].price, 4000);

const oldEvent = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
const keptEvent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
const oldKey = `${oldEvent}|Old`;
const keptKey = `${keptEvent}|Keep`;
const pruned = updatePreNewsStore({
  [oldKey]: { price: 3900, capturedAt: oldEvent },
  [keptKey]: { price: 3910, capturedAt: keptEvent },
}, [], null, now);
assert.deepEqual(Object.keys(pruned), [keptKey]);

const kept = updatePreNewsStore({ [keptKey]: { price: 3910, capturedAt: keptEvent } }, events, null, now);
assert.equal(kept[keptKey].price, 3910);

console.log('Passed pre-news snapshot store tests (capture, overwrite, prune, fallback)');
