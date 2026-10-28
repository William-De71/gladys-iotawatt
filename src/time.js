// -----------------------------------------------------------------------------
// Times. The IoTaWatt works in its own local time (its queries, the periods
// of the scene action); the integration only needs the timezone of Gladys
// (TZ, given by the supervisor) to guess the language before any widget, and
// UTC instants for the charts. Intl only (no dependency).
// -----------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * @description The timezone of the instance.
 * @returns {string|undefined} An IANA name, undefined for the system one.
 */
function defaultTimeZone() {
  return process.env.TZ || undefined;
}

/**
 * @description Whether a text is a timezone Intl knows.
 * @param {unknown} value - "Europe/Paris", "Australia/Sydney".
 * @returns {boolean} True when valid.
 */
function isTimeZone(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * @description The timezone to use: the one of Gladys when valid, else UTC.
 * @param {string} [zone] - The timezone of Gladys.
 * @returns {string} An IANA name.
 */
function usableTimeZone(zone = defaultTimeZone()) {
  return isTimeZone(zone) ? zone.trim() : 'UTC';
}

export { MINUTE_MS, HOUR_MS, defaultTimeZone, isTimeZone, usableTimeZone };
