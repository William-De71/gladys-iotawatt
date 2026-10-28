// -----------------------------------------------------------------------------
// Dashboard widgets of the IoTaWatt integration (pure builders: app.js gives
// them what it read).
//
//   - overview: one IoTaWatt, the power of its busiest channels and its state
//     (reachable, Wi-Fi, clock battery, firmware, uptime);
//   - channel:  one channel, its power now, the energy of today and
//     yesterday, and a chart from the IoTaWatt's log (power over 24 hours,
//     energy per day over 14 days or per month over 12 months).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, ago, formatNumber } from './i18n.js';
import { prettyName } from './device.js';
import { UNITS } from './parse.js';

const WIDGETS = { OVERVIEW: 'overview', CHANNEL: 'channel' };
const VIEWS = {
  POWER_DAY: 'power_day',
  ENERGY_DAYS: 'energy_days',
  ENERGY_MONTHS: 'energy_months',
};
const TTL_SECONDS = { overview: 60, channel: 300, message: 120 };
// Heading + 5 tiles + status + caption: the 8 components of the budget.
const MAX_TILES = 5;

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A widget content made of one message.
 * @param {string} message - The message.
 * @param {object} [options] - `{ heading, ttl }`.
 * @returns {object} The content.
 */
function messageContent(message, { heading, ttl = TTL_SECONDS.message } = {}) {
  const components = [];
  if (heading) {
    components.push({ type: 'text', variant: 'heading', text: clip(heading, 40) });
  }
  components.push({ type: 'text', variant: 'body', text: clip(message, 300) });
  return { ttl_seconds: ttl, components };
}

/**
 * @description A power as a tile value: W below 10 kW, kW above.
 * @param {number|null} watts - The power.
 * @param {string} language - The language.
 * @returns {{ value: string, unit?: string }} The value and its unit.
 */
function powerValue(watts, language) {
  if (!Number.isFinite(watts)) return { value: '–' };
  if (Math.abs(watts) >= 10000) {
    return { value: clip(formatNumber(watts / 1000, language, 1), 12), unit: 'kW' };
  }
  return { value: clip(formatNumber(watts, language, 0), 12), unit: 'W' };
}

/**
 * @description An energy as a tile value.
 * @param {number|null} kwh - The energy.
 * @param {string} language - The language.
 * @returns {{ value: string, unit?: string }} The value and its unit.
 */
function energyValue(kwh, language) {
  if (!Number.isFinite(kwh)) return { value: '–' };
  return {
    value: clip(formatNumber(kwh, language, Math.abs(kwh) >= 100 ? 0 : 2), 12),
    unit: 'kWh',
  };
}

/**
 * @description An uptime as text: "3 d 4 h", "5 h 12 min".
 * @param {number|null} seconds - The uptime.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function uptimeText(seconds, language) {
  if (!Number.isFinite(seconds)) return '–';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return t('uptimeDays', language, { d: days, h: hours % 24 });
  if (hours > 0) return t('uptimeHours', language, { h: hours, m: minutes % 60 });
  return t('uptimeMinutes', language, { m: minutes });
}

/**
 * @description The "overview" widget.
 * @param {object} options - Options.
 * @param {object} options.meter - The stored meter.
 * @param {string} options.name - Its name (the Gladys one when created).
 * @param {Function} options.channelName - `(channel) => name` (the Gladys one when created).
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildOverviewWidget({ meter, name, channelName, language, now }) {
  const status = meter.status ?? {};
  const down = Boolean(meter.seen?.down);
  const power = (meter.channels ?? []).filter(
    (channel) => channel.unit === UNITS.WATTS && Number.isFinite(channel.value),
  );
  const busiest = [...power]
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, MAX_TILES);
  const components = [{ type: 'text', variant: 'heading', text: clip(name, 40) }];
  for (const channel of busiest) {
    components.push({
      type: 'value',
      label: clip(channelName(channel), 24),
      ...powerValue(channel.value, language),
      icon: channel.value < 0 ? 'sun' : 'zap',
      color: down
        ? WIDGET_COLORS.NEUTRAL
        : channel.value < 0
          ? WIDGET_COLORS.SUCCESS
          : WIDGET_COLORS.PRIMARY,
    });
  }
  const rssi = status.rssi;
  const rows = [
    {
      label: clip(t('rowState', language), 40),
      value: clip(t(down ? 'stateUnreachable' : 'stateOnline', language), 40),
      color: down ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      label: clip(t('rowLastReading', language), 40),
      value: clip(ago(meter.readAt ?? 0, now, language), 40),
      color: down ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (Number.isFinite(rssi)) {
    rows.push({
      label: clip(t('rowWifi', language), 40),
      value: `${Math.round(rssi)} dBm`,
      color:
        rssi >= -70
          ? WIDGET_COLORS.SUCCESS
          : rssi >= -80
            ? WIDGET_COLORS.WARNING
            : WIDGET_COLORS.DANGER,
    });
  }
  if (typeof status.lowBattery === 'boolean') {
    rows.push({
      label: clip(t('rowClockBattery', language), 40),
      value: clip(t(status.lowBattery ? 'batteryLow' : 'batteryOk', language), 40),
      color: status.lowBattery ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    });
  }
  if (Number.isFinite(status.uptime)) {
    rows.push({
      label: clip(t('rowUptime', language), 40),
      value: clip(uptimeText(status.uptime, language), 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (status.firmware) {
    rows.push({
      label: clip(t('rowFirmware', language), 40),
      value: clip(status.firmware, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items: rows });
  if (!busiest.length) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: clip(t('widgetNoPower', language), 80),
    });
  } else if (power.length > busiest.length) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: clip(t('widgetMore', language, { count: power.length - busiest.length }), 80),
    });
  }
  return { ttl_seconds: TTL_SECONDS.overview, components };
}

/**
 * @description The "channel" widget.
 * @param {object} options - Options.
 * @param {object} options.channel - The channel (parse.js channelsOf).
 * @param {string} options.name - Its name (the Gladys one when created).
 * @param {boolean} options.down - The IoTaWatt does not answer.
 * @param {string} options.view - A VIEWS value.
 * @param {object} options.history - `{ today, yesterday, points: [{ t, v }] }` (kWh, W or V), or null.
 * @param {string} options.language - The user language.
 * @returns {object} The content.
 */
function buildChannelWidget({ channel, name, down, view, history, language }) {
  const watts = channel.unit === UNITS.WATTS;
  const components = [{ type: 'text', variant: 'heading', text: clip(name, 40) }];
  const color = down ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.PRIMARY;
  if (watts) {
    components.push({
      type: 'value',
      label: clip(t('tileNow', language), 24),
      ...powerValue(channel.value, language),
      icon: Number.isFinite(channel.value) && channel.value < 0 ? 'sun' : 'zap',
      color,
    });
    components.push({
      type: 'value',
      label: clip(t('tileToday', language), 24),
      ...energyValue(history?.today, language),
      icon: 'calendar',
      color: WIDGET_COLORS.INFO,
    });
    components.push({
      type: 'value',
      label: clip(t('tileYesterday', language), 24),
      ...energyValue(history?.yesterday, language),
      icon: 'clock',
      color: WIDGET_COLORS.NEUTRAL,
    });
  } else {
    const unit = channel.unit === UNITS.VOLTS ? 'V' : 'A';
    components.push({
      type: 'value',
      label: clip(t('tileNow', language), 24),
      value: Number.isFinite(channel.value)
        ? clip(formatNumber(channel.value, language, 1), 12)
        : '–',
      ...(Number.isFinite(channel.value) ? { unit } : {}),
      icon: 'activity',
      color,
    });
  }
  const points = (history?.points ?? []).filter((point) => Number.isFinite(point.v)).slice(-300);
  const chart = chartOf({ channel, view: watts ? view : VIEWS.POWER_DAY, language });
  if (points.length >= 2) {
    components.push({
      type: 'chart',
      chart_type: chart.type,
      title: clip(chart.title, 60),
      unit: chart.unit,
      series: [{ name: clip(prettyName(channel.name), 40), points }],
    });
  } else if (!down) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: clip(t('widgetNoHistory', language), 80),
    });
  }
  // Two texts at most: the heading and this one.
  if (down) {
    components.push({ type: 'text', variant: 'body', text: clip(t('widgetDown', language), 300) });
  }
  return { ttl_seconds: TTL_SECONDS.channel, components };
}

/**
 * @description The chart of a view.
 * @param {object} options - `{ channel, view, language }`.
 * @returns {{ type: string, unit: string, title: string }} The chart.
 */
function chartOf({ channel, view, language }) {
  if (channel.unit !== UNITS.WATTS) {
    const unit = channel.unit === UNITS.VOLTS ? 'V' : 'A';
    return { type: 'line', unit, title: t('chartValueDay', language) };
  }
  if (view === VIEWS.ENERGY_DAYS)
    return { type: 'bar', unit: 'kWh', title: t('chartEnergyDays', language) };
  if (view === VIEWS.ENERGY_MONTHS) {
    return { type: 'bar', unit: 'kWh', title: t('chartEnergyMonths', language) };
  }
  return { type: 'area', unit: 'W', title: t('chartPowerDay', language) };
}

export {
  WIDGETS,
  VIEWS,
  TTL_SECONDS,
  MAX_TILES,
  clip,
  messageContent,
  powerValue,
  energyValue,
  uptimeText,
  buildOverviewWidget,
  buildChannelWidget,
  chartOf,
};
