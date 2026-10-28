# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-10-28

### Added

- **meters:** every IoTaWatt energy monitor of the local network, through its local API, read only: addresses typed in the configuration, or found with mDNS through the Gladys core; known by its MAC address, so a new IP address is followed; optional HTTP Digest password
- **devices:** the meter itself (Wi-Fi signal, low clock battery, firmware) and one device per input or output: power, energy consumed and, once a channel goes negative, energy exported, voltage, current
- **energy:** cumulative indexes counted every minute from the IoTaWatt's own log, so a restart of the container or of Gladys loses nothing (up to 7 days of catch-up)
- **scenes:** triggers when an IoTaWatt stops answering, answers again or restarted; an action to get the energy and the average power of a channel over a period (today, yesterday, this week, last month…)
- **widgets:** one IoTaWatt with the power of its busiest channels and its state; one channel with its power, the energy of today and yesterday, and a chart from the IoTaWatt's log (24 hours of power, 14 days or 12 months of energy)
- **configuration:** addresses, user and password, power reading every 10, 30 or 60 seconds, language, "Search and test" and "Diagnostic" buttons
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README

[0.1.0]: https://github.com/William-De71/gladys-iotawatt/releases/tag/v0.1.0
