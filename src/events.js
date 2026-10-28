// -----------------------------------------------------------------------------
// Scene triggers and the scene action of the IoTaWatt integration.
//
// Triggers (once per transition, worked out after each reading, never from a
// scene action, never at the first reading of a meter):
//   - meter_unreachable  no answer UNREACHABLE_AFTER times in a row, and for
//                        at least UNREACHABLE_MIN_MS;
//   - meter_back_online  it answers again;
//   - meter_restarted    its uptime went back (power cut, update, crash).
//
// Scene action:
//   - get_energy         the energy of a channel over a period, asked to the
//                        IoTaWatt (its log, in its own local time).
// -----------------------------------------------------------------------------

const TRIGGERS = {
  UNREACHABLE: 'meter_unreachable',
  BACK_ONLINE: 'meter_back_online',
  RESTARTED: 'meter_restarted',
};
const SCENE_ACTIONS = { GET_ENERGY: 'get_energy' };
const ENERGY_OUTPUTS = [
  'channel_name',
  'energy_kwh',
  'average_watts',
  'period_start',
  'period_end',
  'summary',
];
const UNREACHABLE_AFTER = 3;
const UNREACHABLE_MIN_MS = 60 * 1000;

// The periods of get_energy, in the relative times of the IoTaWatt query
// (https://docs.iotawatt.com/en/master/query.html): `d` today 00:00, `w` the
// start of the week (Sunday), `M` the first of the month, `y` the first of
// January, `s` now; all in the local time of the IoTaWatt.
const PERIODS = {
  today: ['d', 's'],
  yesterday: ['d-1d', 'd'],
  this_week: ['w', 's'],
  last_week: ['w-1w', 'w'],
  this_month: ['M', 's'],
  last_month: ['M-1M', 'M'],
  this_year: ['y', 's'],
  last_24_hours: ['s-24h', 's'],
  last_7_days: ['s-7d', 's'],
  last_30_days: ['s-30d', 's'],
};
const DEFAULT_PERIOD = 'today';

/**
 * @description Keep only the declared keys of an object (outputs).
 * @param {object} values - The values.
 * @param {string[]} keys - The declared keys.
 * @returns {object} The kept values, without the null ones.
 */
function pick(values, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => values[key] !== undefined && values[key] !== null)
      .map((key) => [key, values[key]]),
  );
}

/**
 * @description A number rounded to some decimals.
 * @param {number|null} value - The value.
 * @param {number} decimals - The decimals.
 * @returns {number|null} The rounded value.
 */
function rounded(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * @description What changed for a meter after a reading.
 * @param {object} previous - `{ reachable, failures, since, uptime, down }` (or undefined).
 * @param {object} reading - `{ ok: boolean, uptime: number|null, now: number }`.
 * @returns {{ next: object, events: Array<{ key: string, data: object }> }} The new
 * state and the events (data without the meter identity).
 */
function detectMeter(previous, reading) {
  const state = previous ?? { failures: 0, since: null, uptime: null, down: false, seen: false };
  const events = [];
  const next = { ...state };
  if (!reading.ok) {
    next.failures = (state.failures ?? 0) + 1;
    next.since ??= reading.now;
    if (
      !state.down &&
      state.seen &&
      next.failures >= UNREACHABLE_AFTER &&
      reading.now - next.since >= UNREACHABLE_MIN_MS
    ) {
      next.down = true;
      events.push({ key: TRIGGERS.UNREACHABLE, data: { failures: next.failures } });
    }
    return { next, events };
  }
  if (state.down) {
    events.push({
      key: TRIGGERS.BACK_ONLINE,
      data: {
        down_minutes: Math.max(0, Math.round((reading.now - (state.since ?? reading.now)) / 60000)),
      },
    });
  }
  if (
    state.seen &&
    Number.isFinite(state.uptime) &&
    Number.isFinite(reading.uptime) &&
    reading.uptime < state.uptime
  ) {
    events.push({
      key: TRIGGERS.RESTARTED,
      data: { uptime_before_hours: rounded(state.uptime / 3600, 1) },
    });
  }
  next.failures = 0;
  next.since = null;
  next.down = false;
  next.seen = true;
  next.uptime = Number.isFinite(reading.uptime) ? reading.uptime : state.uptime;
  return { next, events };
}

export {
  TRIGGERS,
  SCENE_ACTIONS,
  ENERGY_OUTPUTS,
  UNREACHABLE_AFTER,
  UNREACHABLE_MIN_MS,
  PERIODS,
  DEFAULT_PERIOD,
  pick,
  rounded,
  detectMeter,
};
