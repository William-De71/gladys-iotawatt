// -----------------------------------------------------------------------------
// The energy indexes, made from the IoTaWatt's own data log.
//
// Gladys works out consumption (and its cost) from a cumulative index. An
// IoTaWatt keeps every power series in its log (5-second points for about a
// year, 1-minute points for years), and its query gives the energy of each
// minute (`<series>.wh`). Once a minute the integration asks for the minutes
// it has not counted yet, up to the last point logged, and adds them:
//   - the positive minutes to `importWh` (energy-sensor/index);
//   - the negative ones, as positive values, to `exportWh`
//     (energy-production-sensor/index): a series that goes negative (a mains
//     CT while solar panels export, a signed output) is "bidirectional", and
//     only then gets the export feature.
// So a restart of the container or of Gladys loses nothing: the next round
// catches up (at most CATCH_UP_S back, in chunks of CHUNK_S). The indexes
// start at 0 when the integration first sees the series: Gladys only uses
// their increases.
// -----------------------------------------------------------------------------

const MINUTE_S = 60;
const CHUNK_S = 12 * 60 * MINUTE_S; // 720 rows: under the 1000-line default limit
const CATCH_UP_S = 7 * 24 * 60 * MINUTE_S;
// Below this, a negative minute is noise of the measurement (0.5 Wh = 30 W).
const EXPORT_THRESHOLD_WH = 0.5;

const floorMinute = (seconds) => Math.floor(seconds / MINUTE_S) * MINUTE_S;

/**
 * @description The next window to count, or null when nothing complete is logged yet.
 * @param {number|null} cursor - The first second not counted yet (0/null: never counted).
 * @param {number|null} lastKey - The last logged point of the device (Unix seconds).
 * @returns {{ begin: number, end: number, start: boolean }|null} The window;
 * `start` when the counting starts now (nothing to add).
 */
function nextWindow(cursor, lastKey) {
  if (!Number.isFinite(lastKey) || lastKey <= 0) {
    return null;
  }
  const end = floorMinute(lastKey);
  if (!Number.isFinite(cursor) || cursor <= 0) {
    return { begin: end, end, start: true };
  }
  const begin = Math.max(floorMinute(cursor), end - CATCH_UP_S);
  if (end - begin < MINUTE_S) {
    return null;
  }
  return { begin, end: Math.min(end, begin + CHUNK_S), start: false };
}

/**
 * @description The select of an energy query.
 * @param {string[]} names - The series names.
 * @returns {string[]} `["time.utc.unix", "<name>.wh.d3", …]`.
 */
const energySelect = (names) => ['time.utc.unix', ...names.map((name) => `${name}.wh.d3`)];

/**
 * @description Add the minutes of an energy query to the totals.
 * @param {object} options - Options.
 * @param {Array<Array<number|null>>} options.rows - parseRows() of the query, time first.
 * @param {string[]} options.keys - The channel key of each series column.
 * @param {object} options.totals - `{ [key]: { importWh, exportWh } }`, updated.
 * @param {object} options.window - nextWindow().
 * @returns {{ cursor: number, negative: string[] }} The next cursor, and the
 * keys that went negative (bidirectional).
 */
function addEnergy({ rows, keys, totals, window }) {
  const negative = new Set();
  let cursor = window.begin;
  for (const row of rows) {
    const time = row[0];
    if (!Number.isFinite(time) || time < window.begin || time >= window.end) {
      continue;
    }
    keys.forEach((key, index) => {
      const wh = row[index + 1];
      if (!Number.isFinite(wh)) return;
      const total = (totals[key] ??= { importWh: 0, exportWh: 0 });
      if (wh >= 0) {
        total.importWh += wh;
      } else {
        total.exportWh += -wh;
        if (-wh >= EXPORT_THRESHOLD_WH) negative.add(key);
      }
    });
    cursor = Math.max(cursor, time + MINUTE_S);
  }
  // Minutes the device did not log (it was off) are never asked again.
  return { cursor: Math.max(cursor, window.end), negative: [...negative] };
}

/**
 * @description The keys whose hourly energy went negative (the first look
 * at a series, over the last 7 days).
 * @param {Array<Array<number|null>>} rows - parseRows() of an hourly `.wh` query, no time column.
 * @param {string[]} keys - The channel key of each column.
 * @returns {string[]} The bidirectional keys.
 */
function negativeKeys(rows, keys) {
  return keys.filter((key, index) =>
    rows.some((row) => Number.isFinite(row[index]) && row[index] <= -EXPORT_THRESHOLD_WH),
  );
}

export {
  MINUTE_S,
  CHUNK_S,
  CATCH_UP_S,
  EXPORT_THRESHOLD_WH,
  floorMinute,
  nextWindow,
  energySelect,
  addEnergy,
  negativeKeys,
};
