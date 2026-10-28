// -----------------------------------------------------------------------------
// Where the IoTaWatt devices are.
//
//   - The addresses the user typed (IP or name, comma, space or line
//     separated, optionally `:port`).
//   - mDNS: an IoTaWatt announces `<device name>._http._tcp` (firmware,
//     WiFi.cpp) with no TXT record, like countless other web servers. The
//     container cannot see mDNS (bridge network): the Gladys core browses for
//     it (manifest `network_discovery`, `gladys.scanNetwork('mdns')`). Only the
//     names that contain "iota" are tried (the default name is "IotaWatt"); a
//     renamed device is typed in by hand.
// Every candidate is then asked for its /status: only an answer with an
// IoTaWatt firmware version and a MAC address makes it a meter.
// -----------------------------------------------------------------------------

const MAX_HOSTS = 10;

/**
 * @description The addresses typed in the configuration.
 * @param {unknown} value - "192.168.1.20, iotawatt.local".
 * @returns {string[]} The addresses, without duplicates.
 */
function parseHosts(value) {
  const list = String(value ?? '')
    .split(/[\s,;]+/)
    .map((entry) =>
      entry
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, ''),
    )
    .filter((entry) => /^[A-Za-z0-9.:[\]_-]{1,253}$/.test(entry));
  return [...new Set(list.map((entry) => entry.toLowerCase()))].slice(0, MAX_HOSTS);
}

/**
 * @description The addresses of the IoTaWatt-like mDNS services.
 * @param {unknown} services - `scanNetwork('mdns')`: `[{ name, host, addresses, port }]`.
 * @returns {string[]} "192.168.1.20" or "192.168.1.20:8080".
 */
function mdnsCandidates(services) {
  const found = [];
  for (const service of Array.isArray(services) ? services : []) {
    const name = `${service?.name ?? ''} ${service?.host ?? ''}`;
    if (!/iota/i.test(name)) continue;
    const addresses = Array.isArray(service.addresses) ? service.addresses : [];
    // IPv4 first: the firmware only has IPv4.
    const address =
      addresses.find((entry) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(entry))) ??
      (typeof service.host === 'string' ? service.host.replace(/\.$/, '') : null);
    if (!address) continue;
    const port = Number(service.port);
    found.push(Number.isInteger(port) && port > 0 && port !== 80 ? `${address}:${port}` : address);
  }
  return [...new Set(found)].slice(0, MAX_HOSTS);
}

export { MAX_HOSTS, parseHosts, mdnsCandidates };
