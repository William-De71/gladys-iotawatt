// -----------------------------------------------------------------------------
// The answers of an IoTaWatt made safe: absent is null (never 0), numbers
// are finite, names are strings.
//
// A "channel" is what Gladys gets a device for:
//   - an input (a CT measures power, a VT voltage), known by its channel
//     number (0 to 14), which never changes when the owner renames it;
//   - an output (a calculated series: "mains = CT1 + CT2", "solar"…), known
//     by its name only.
// /status gives the inputs by channel number without their names, and
// /query?show=series the names without the channel numbers: both list the
// active inputs in the order of their channel numbers (firmware), so they
// are paired by position, and only when the kinds (power / voltage) agree.
// -----------------------------------------------------------------------------

const UNITS = { WATTS: 'Watts', VOLTS: 'Volts', AMPS: 'Amps' };
// The outputs Gladys can show: power, voltage, current. VA, VAR, PF, Hz and
// the others have no matching feature in Gladys.
const SUPPORTED_UNITS = [UNITS.WATTS, UNITS.VOLTS, UNITS.AMPS];
const MAX_CHANNELS = 64;

const number = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
const text = (value, max = 64) =>
  typeof value === 'string'
    ? value.trim().slice(0, max)
    : typeof value === 'number'
      ? String(value)
      : '';
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * @description A MAC address as 12 lowercase hexadecimal digits.
 * @param {unknown} value - "5C:CF:7F:12:34:56".
 * @returns {string|null} "5ccf7f123456".
 */
function macOf(value) {
  const hex = String(value ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  return hex.length === 12 && hex !== '000000000000' ? hex : null;
}

/**
 * @description The answer of /status.
 * @param {unknown} json - The JSON.
 * @returns {object} `{ name, firmware, mac, ip, rssi, lowBattery, uptime, frequency,
 * lastKey, inputs: [{ channel, kind, value, pf }], outputs: [{ name, units, value }] }`.
 */
function parseStatus(json) {
  const root = isObject(json) ? json : {};
  const device = isObject(root.device) ? root.device : {};
  const stats = isObject(root.stats) ? root.stats : {};
  const wifi = isObject(root.wifi) ? root.wifi : {};
  const logs = Array.isArray(root.datalogs) ? root.datalogs : [];
  const current = logs.find((log) => isObject(log) && log.id === 'Current') ?? {};
  const inputs = (Array.isArray(root.inputs) ? root.inputs : [])
    .filter(isObject)
    .slice(0, MAX_CHANNELS)
    .map((input) => {
      const channel = number(input.channel);
      if (!Number.isInteger(channel) || channel < 0) return null;
      if ('Vrms' in input) {
        return { channel, kind: 'voltage', value: number(input.Vrms), pf: null };
      }
      if ('Watts' in input) {
        return { channel, kind: 'power', value: number(input.Watts), pf: number(input.Pf) };
      }
      return null;
    })
    .filter(Boolean);
  const outputs = (Array.isArray(root.outputs) ? root.outputs : [])
    .filter(isObject)
    .slice(0, MAX_CHANNELS)
    .map((output) => ({
      name: text(output.name),
      units: text(output.units, 16),
      value: number(output.value),
    }))
    .filter((output) => output.name);
  const lowbat = stats.lowbat;
  return {
    name: text(device.name) || null,
    firmware: text(stats.version, 16) || null,
    mac: macOf(wifi.mac),
    ip: text(wifi.IP, 64) || null,
    rssi: number(wifi.RSSI),
    lowBattery:
      typeof lowbat === 'boolean' ? lowbat : number(lowbat) === null ? null : number(lowbat) !== 0,
    uptime: number(stats.runseconds),
    frequency: number(stats.frequency),
    lastKey: number(current.lastkey),
    inputs,
    outputs,
  };
}

/**
 * @description The answer of /query?show=series.
 * @param {unknown} json - The JSON.
 * @returns {Array<{ name: string, unit: string }>} The series.
 */
function parseSeries(json) {
  const list = isObject(json) && Array.isArray(json.series) ? json.series : [];
  return list
    .filter(isObject)
    .map((entry) => ({ name: text(entry.name), unit: text(entry.unit, 16) }))
    .filter((entry) => entry.name)
    .slice(0, 2 * MAX_CHANNELS);
}

/**
 * @description The key of an output, safe for an external id.
 * @param {string} name - The output name.
 * @returns {string} "out-solar".
 */
const outputKey = (name) =>
  `out-${String(name)
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .slice(0, 48)}`;

/**
 * @description The channels of an IoTaWatt: its inputs (named from the
 * series list) and its outputs.
 * @param {object} status - parseStatus().
 * @param {Array<object>} series - parseSeries() (empty when not read yet).
 * @returns {object[]} `{ key, source, channel, name, unit, value, supported }`.
 */
function channelsOf(status, series) {
  const inputUnits = { power: UNITS.WATTS, voltage: UNITS.VOLTS };
  const inputSeries = series.slice(0, status.inputs.length);
  const paired =
    inputSeries.length === status.inputs.length &&
    status.inputs.every((input, index) => inputSeries[index].unit === inputUnits[input.kind]);
  const inputs = status.inputs.map((input, index) => ({
    key: `in${input.channel}`,
    source: 'input',
    channel: input.channel,
    // Without a reliable pairing, the channel number names the input.
    name: paired ? inputSeries[index].name : `Input ${input.channel}`,
    // The name the queries need: unknown without the pairing.
    series: paired ? inputSeries[index].name : null,
    unit: inputUnits[input.kind],
    value: input.value,
    supported: true,
  }));
  const keys = new Set();
  const outputs = status.outputs
    .map((output) => ({
      key: outputKey(output.name),
      source: 'output',
      channel: null,
      name: output.name,
      series: output.name,
      unit: output.units,
      value: output.value,
      supported: SUPPORTED_UNITS.includes(output.units),
    }))
    .filter((output) => {
      if (keys.has(output.key)) return false;
      keys.add(output.key);
      return true;
    });
  return [...inputs, ...outputs];
}

/**
 * @description The rows of a query (`[[…], …]`, or `{ data }` with a header).
 * @param {unknown} json - The JSON.
 * @returns {Array<Array<number|null>>} The rows, every cell a finite number or null.
 */
function parseRows(json) {
  const rows = Array.isArray(json)
    ? json
    : isObject(json) && Array.isArray(json.data)
      ? json.data
      : [];
  return rows
    .filter(Array.isArray)
    .map((row) => row.map((cell) => (typeof cell === 'string' ? cell : number(cell))));
}

export {
  UNITS,
  SUPPORTED_UNITS,
  macOf,
  parseStatus,
  parseSeries,
  outputKey,
  channelsOf,
  parseRows,
};
