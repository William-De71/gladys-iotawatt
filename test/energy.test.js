// The energy indexes (energy.js), the reachability triggers (events.js) and
// the discovery helpers (discovery.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextWindow,
  energySelect,
  addEnergy,
  negativeKeys,
  CHUNK_S,
  CATCH_UP_S,
} from '../src/energy.js';
import { detectMeter, TRIGGERS, UNREACHABLE_MIN_MS, pick, rounded } from '../src/events.js';
import { parseHosts, mdnsCandidates } from '../src/discovery.js';

const T0 = 1761642000; // 2025-10-28T09:00:00Z, a whole minute

test('windows: start now, whole minutes up to the last logged point, chunks, a bounded catch-up', () => {
  assert.equal(nextWindow(0, null), null, 'nothing logged');
  assert.deepEqual(nextWindow(0, T0 + 42), { begin: T0, end: T0, start: true });
  assert.equal(nextWindow(T0, T0 + 55), null, 'the minute is not complete');
  assert.deepEqual(nextWindow(T0, T0 + 125), { begin: T0, end: T0 + 120, start: false });
  assert.deepEqual(nextWindow(T0, T0 + 2 * CHUNK_S), {
    begin: T0,
    end: T0 + CHUNK_S,
    start: false,
  });
  const far = nextWindow(T0, T0 + 30 * 86400);
  assert.equal(far.begin, T0 + 30 * 86400 - CATCH_UP_S, 'at most a week back');
  assert.deepEqual(energySelect(['Mains', 'Solar']), [
    'time.utc.unix',
    'Mains.wh.d3',
    'Solar.wh.d3',
  ]);
});

test('counting: positive minutes are drawn, negative ones exported; the cursor moves on', () => {
  const totals = { in1: { importWh: 10, exportWh: 0 } };
  const window = { begin: T0, end: T0 + 180, start: false };
  const rows = [
    [T0, 25, -20],
    [T0 + 60, 26, 0.2],
    [T0 + 120, null, -0.3],
    [T0 - 60, 999, 999], // outside: ignored
  ];
  const { cursor, negative } = addEnergy({ rows, keys: ['in1', 'in4'], totals, window });
  assert.equal(cursor, T0 + 180);
  assert.deepEqual(totals, {
    in1: { importWh: 61, exportWh: 0 },
    in4: { importWh: 0.2, exportWh: 20.3 },
  });
  assert.deepEqual(negative, ['in4']);
  // Nothing logged (the device was off): the window is still done.
  assert.equal(addEnergy({ rows: [], keys: ['in1'], totals, window }).cursor, T0 + 180);
  assert.deepEqual(
    negativeKeys(
      [
        [10, -0.1],
        [12, -3],
      ],
      ['a', 'b'],
    ),
    ['b'],
  );
});

test('reachability: unreachable after 3 failures and a minute, once; back online; a restart', () => {
  const now = Date.parse('2026-10-28T09:00:00Z');
  let { next, events } = detectMeter(undefined, { ok: true, uptime: 1000, now });
  assert.deepEqual(events, [], 'never at the first reading');
  for (let i = 1; i <= 2; i += 1) {
    ({ next, events } = detectMeter(next, { ok: false, uptime: null, now: now + i * 30000 }));
    assert.deepEqual(events, []);
  }
  ({ next, events } = detectMeter(next, {
    ok: false,
    uptime: null,
    now: now + 30000 + UNREACHABLE_MIN_MS,
  }));
  assert.deepEqual(
    events.map((event) => event.key),
    [TRIGGERS.UNREACHABLE],
  );
  ({ next, events } = detectMeter(next, { ok: false, uptime: null, now: now + 200000 }));
  assert.deepEqual(events, [], 'once');
  ({ next, events } = detectMeter(next, { ok: true, uptime: 30, now: now + 300000 }));
  assert.deepEqual(
    events.map((event) => event.key),
    [TRIGGERS.BACK_ONLINE, TRIGGERS.RESTARTED],
  );
  assert.equal(events[0].data.down_minutes, 5);
  assert.equal(next.down, false);
  // Never unreachable before a first answer.
  let state;
  for (let i = 0; i < 5; i += 1) {
    ({ next: state, events } = detectMeter(state, {
      ok: false,
      uptime: null,
      now: now + i * 60000,
    }));
    assert.deepEqual(events, []);
  }
  assert.deepEqual(pick({ a: 1, b: null, c: 2 }, ['a', 'b']), { a: 1 });
  assert.equal(rounded(1.23456, 2), 1.23);
});

test('discovery: typed addresses cleaned, mDNS names with "iota" only, IPv4 first', () => {
  assert.deepEqual(
    parseHosts('http://192.168.1.20/status, iotawatt.local:8080\n10.0.0.5 ; bad/host!'),
    ['192.168.1.20', 'iotawatt.local:8080', '10.0.0.5', 'bad'],
  );
  assert.deepEqual(parseHosts(undefined), []);
  assert.deepEqual(
    mdnsCandidates([
      {
        name: 'IotaWatt',
        host: 'IotaWatt.local.',
        addresses: ['fe80::1', '192.168.1.31'],
        port: 80,
      },
      { name: 'Garage', host: 'iotawatt-garage.local.', addresses: [], port: 8080 },
      { name: 'Printer', host: 'printer.local.', addresses: ['192.168.1.40'], port: 80 },
      null,
    ]),
    ['192.168.1.31', 'iotawatt-garage.local:8080'],
  );
});
