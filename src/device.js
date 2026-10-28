// -----------------------------------------------------------------------------
// The Gladys devices of an IoTaWatt:
//
//   - the meter itself: `ext:<selector>:meter:<mac>` (Wi-Fi signal, low
//     battery of the clock, firmware);
//   - one device per channel, so the user adds only the circuits they want
//     and puts each in its room: `ext:<selector>:channel:<mac>-in<n>` for
//     the input on channel n (the number stays when the input is renamed),
//     `ext:<selector>:channel:<mac>-out-<name>` for an output (an output has
//     no other identity than its name: renamed, it is a new device).
//
// Features of a channel, after its unit:
//   - Watts: power (energy-sensor/power, W, signed), energy (energy-sensor/
//     index, kWh, what was drawn), and energy_export (energy-production-
//     sensor/index, kWh) once the series was seen negative;
//   - Volts: voltage (energy-sensor/voltage, V);
//   - Amps: current (energy-sensor/current, A).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';
import { UNITS } from './parse.js';

const METER_TYPE = 'meter';
const CHANNEL_TYPE = 'channel';
const MAX_POWER = 100000;
const MAX_INDEX = 1000000000;
const MAX_VOLTAGE = 1000;
const MAX_CURRENT = 1000;

const FEATURES = {
  power: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.POWER,
    unit: U.WATT,
    min: -MAX_POWER,
    max: MAX_POWER,
  },
  energy: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.INDEX,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: MAX_INDEX,
  },
  energy_export: {
    category: C.ENERGY_PRODUCTION_SENSOR,
    type: T.ENERGY_PRODUCTION_SENSOR.INDEX,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: MAX_INDEX,
  },
  voltage: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.VOLTAGE,
    unit: U.VOLT,
    min: 0,
    max: MAX_VOLTAGE,
  },
  current: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.CURRENT,
    unit: U.AMPERE,
    min: -MAX_CURRENT,
    max: MAX_CURRENT,
  },
  rssi: { category: C.SIGNAL, type: T.SIGNAL.QUALITY, unit: null, min: -120, max: 0 },
  rtc_battery_low: {
    category: C.BATTERY_LOW,
    type: T.BATTERY_LOW.BINARY,
    unit: null,
    min: 0,
    max: 1,
  },
  firmware: { category: C.TEXT, type: T.TEXT.TEXT, unit: null, min: 0, max: 0 },
};
const METER_FEATURES = ['rssi', 'rtc_battery_low', 'firmware'];

/**
 * @description The ids of a meter.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} mac - 12 hexadecimal digits.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const meterIds = (gladys, mac) => gladys.externalIds(METER_TYPE, mac);

/**
 * @description The ids of a channel.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} mac - 12 hexadecimal digits.
 * @param {string} key - "in3", "out-solar".
 * @returns {{ device: string, feature: Function }} The ids.
 */
const channelIds = (gladys, mac, key) => gladys.externalIds(CHANNEL_TYPE, `${mac}-${key}`);

/**
 * @description What a device external id (or a feature id) points to.
 * @param {unknown} externalId - `ext:…:channel:5ccf7f123456-in3` (or `…:power`).
 * @returns {{ type: string, mac: string, key: string|null }|null} The target.
 */
function targetOf(externalId) {
  const match = String(externalId ?? '').match(
    /:(meter|channel):([0-9a-f]{12})(?:-([A-Za-z0-9_-]+?))?(?::[a-z_]+)?$/,
  );
  if (!match) return null;
  return { type: match[1], mac: match[2], key: match[3] ?? null };
}

/**
 * @description The feature keys of a channel.
 * @param {object} channel - channelsOf() entry.
 * @param {boolean} bidirectional - Seen negative.
 * @returns {string[]} The keys.
 */
function channelFeatureKeys(channel, bidirectional) {
  if (channel.unit === UNITS.WATTS) {
    return ['power', 'energy', ...(bidirectional ? ['energy_export'] : [])];
  }
  if (channel.unit === UNITS.VOLTS) return ['voltage'];
  if (channel.unit === UNITS.AMPS) return ['current'];
  return [];
}

/**
 * @description A series name for people: "Heat_Pump" -> "Heat Pump".
 * @param {string} name - The name.
 * @returns {string} The label.
 */
const prettyName = (name) =>
  String(name ?? '')
    .replace(/_/g, ' ')
    .trim();

/**
 * @description The name of a meter: its own name, after "IoTaWatt".
 * @param {object} meter - The stored meter (`name`, `mac`).
 * @returns {string} "IoTaWatt Garage", "IoTaWatt".
 */
function meterName(meter) {
  const name = prettyName(meter.name);
  if (!name || /^iotawatt$/i.test(name)) return 'IoTaWatt';
  return /iotawatt/i.test(name) ? name : `IoTaWatt ${name}`;
}

/**
 * @description The default name of a channel device.
 * @param {object} meter - The stored meter.
 * @param {object} channel - channelsOf() entry.
 * @returns {string} "Heat Pump (IoTaWatt)".
 */
const channelName = (meter, channel) => `${prettyName(channel.name)} (${meterName(meter)})`;

/**
 * @description One feature.
 * @param {Function} id - `feature(key)` of the device ids.
 * @param {string} key - The feature key.
 * @param {string} language - The language of the name.
 * @returns {object} The feature.
 */
function feature(id, key, language) {
  const spec = FEATURES[key];
  return {
    name: t(`feature_${key}`, language),
    external_id: id(key),
    category: spec.category,
    type: spec.type,
    unit: spec.unit,
    min: spec.min,
    max: spec.max,
    read_only: true,
    has_feedback: false,
    keep_history: key !== 'firmware',
  };
}

/**
 * @description The devices of a meter: the meter, then its supported channels.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} meter - The stored meter (`mac`, `name`, `channels`, `bidirectional`).
 * @param {object} [options] - `{ language }`.
 * @returns {object[]} The discovered devices.
 */
function buildMeterDevices(gladys, meter, { language = 'en' } = {}) {
  const ids = meterIds(gladys, meter.mac);
  const devices = [
    {
      name: meterName(meter),
      external_id: ids.device,
      model: 'IoTaWatt',
      should_poll: false,
      params: [{ name: 'IOTAWATT_MAC', value: meter.mac }],
      features: METER_FEATURES.map((key) => feature(ids.feature, key, language)),
    },
  ];
  for (const channel of meter.channels ?? []) {
    const keys = channelFeatureKeys(channel, Boolean(meter.bidirectional?.[channel.key]));
    if (!keys.length) continue;
    const channelId = channelIds(gladys, meter.mac, channel.key);
    devices.push({
      name: channelName(meter, channel),
      external_id: channelId.device,
      model: channel.source === 'input' ? `IoTaWatt input ${channel.channel}` : 'IoTaWatt output',
      should_poll: false,
      params: [
        { name: 'IOTAWATT_MAC', value: meter.mac },
        { name: 'IOTAWATT_SERIES', value: channel.name },
      ],
      features: keys.map((key) => feature(channelId.feature, key, language)),
    });
  }
  return devices;
}

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const bounded = (value, key) => Math.min(FEATURES[key].max, Math.max(FEATURES[key].min, value));

/**
 * @description The states of a meter and its channels; an unknown value is left untouched.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} meter - The stored meter (with `status`, `channels`, `totals`).
 * @returns {object[]} `{ device_feature_external_id, state | text }`.
 */
function buildMeterStates(gladys, meter) {
  const states = [];
  const ids = meterIds(gladys, meter.mac);
  const status = meter.status ?? {};
  if (Number.isFinite(status.rssi)) {
    states.push({
      device_feature_external_id: ids.feature('rssi'),
      state: bounded(Math.round(status.rssi), 'rssi'),
    });
  }
  if (typeof status.lowBattery === 'boolean') {
    states.push({
      device_feature_external_id: ids.feature('rtc_battery_low'),
      state: status.lowBattery ? 1 : 0,
    });
  }
  if (status.firmware) {
    states.push({ device_feature_external_id: ids.feature('firmware'), text: status.firmware });
  }
  for (const channel of meter.channels ?? []) {
    const keys = channelFeatureKeys(channel, Boolean(meter.bidirectional?.[channel.key]));
    const id = channelIds(gladys, meter.mac, channel.key).feature;
    const push = (key, value, decimals) => {
      if (keys.includes(key) && Number.isFinite(value)) {
        states.push({
          device_feature_external_id: id(key),
          state: bounded(round(value, decimals), key),
        });
      }
    };
    if (channel.unit === UNITS.WATTS) {
      push('power', channel.value, 1);
      const total = meter.totals?.[channel.key];
      if (total) {
        push('energy', total.importWh / 1000, 3);
        push('energy_export', total.exportWh / 1000, 3);
      }
    } else if (channel.unit === UNITS.VOLTS) {
      push('voltage', channel.value, 1);
    } else if (channel.unit === UNITS.AMPS) {
      push('current', channel.value, 2);
    }
  }
  return states;
}

export {
  METER_TYPE,
  CHANNEL_TYPE,
  FEATURES,
  METER_FEATURES,
  meterIds,
  channelIds,
  targetOf,
  channelFeatureKeys,
  prettyName,
  meterName,
  channelName,
  buildMeterDevices,
  buildMeterStates,
};
