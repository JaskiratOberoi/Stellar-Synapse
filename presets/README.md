# Location presets

Same instrument models run at different labs with different Online configurations
and different analyte → Noble LIS mappings. Each file here is one **location preset**,
named by lab location (e.g. `haldwani.json`), capturing a known-good config so it
can be reproduced elsewhere for 100% compatibility.

## Convention

- One file per location: `<location>.json` (lowercase, kebab-case).
- A location file has an **`instruments` array** — one entry per analyzer at that
  lab (a location runs several instruments), each keyed by `driverId`.
- Presets are **bundled into the app** at build time (`src/main/core/presets/registry.ts`
  imports each JSON). Adding a location = drop a JSON here, add it to `RAW_PRESETS`,
  rebuild.

## How presets are applied

The **Add Instrument** wizard shows a **"Preset (lab location)"** dropdown in the
config step whenever a preset exists for the selected driver. Choosing a location
auto-fills transport / port / serial and, for Beckman AU analyzers, attaches that
site's **Online Test No. decode table** to the instrument (`InstrumentDefinition.auOnline`).
The AU parser and host-query responder then decode/answer under *that lab's*
numbering instead of the driver default — see `verify:presets` for the guarantee
(wire No. 016 = ALT by default, AST at Jammu).

Only the fields normalized by the registry are applied: `transports[0]`,
`defaultPort`, `serial`, and the AU `onlineTestNoMap`/`onlineTestMenu`. Mappings and
documentation keys are not auto-applied.

## What a preset captures (per instrument)

| Section | Source of truth | Notes |
|---|---|---|
| `instrument` | `catalog.ts` driver entry | driverId, protocol, mode, port, transports, serial line settings |
| `onlineFormat` | `DEFAULT_AU_FORMAT` (Beckman AU) | fixed-field widths; re-certify if the analyzer's Online format changes |
| `onlineTestMenu` | `AU_ONLINE_TESTS` (Beckman AU) | Online Test No. table: no, code, name, unit, ref range, decimals |
| `variantGroups` | driver code | one channel that satisfies several orderable LIS variants |
| `mappings` | **per-site** — the `%APPDATA%\stellar-synapse\stellar-synapse.json` store | analyte → LIS test/param; NOT in code, must be exported from the live install |

## Capturing mappings from a live install

Mappings live in the store keyed by `driverId`. To pull one instrument's rules:

```powershell
$j = Get-Content "$env:APPDATA\stellar-synapse\stellar-synapse.json" -Raw | ConvertFrom-Json
$j.mappings | Where-Object { $_.driverId -eq 'beckman-au480' } | ConvertTo-Json -Depth 5
```

Paste the result into the preset's `mappings` array.

## Presets

- **`haldwani.json`** — instruments:
  - **Beckman Coulter AU480** (`beckman-au480`, clinical chemistry) — captured from
    code defaults; `mappings` still needs to be filled from the Haldwani install.
  - **MAGLUMI X3** (`maglumi-x3`, immunoassay) — captured from the live store: 57
    rules (17 mapped, 40 still unmapped).
- **`jammu.json`** — instruments:
  - **Beckman Coulter AU480** (`beckman-au480`, clinical chemistry) — captured from
    the on-analyzer Online screens (2026-07-07). Carries a Jammu-specific
    `onlineTestNoMap` (different numbering from Haldwani), full serial/protocol/format,
    and 4 analytes beyond the default menu (UALB, CK, LDH, D-Dimer). Online Test Nos
    were transcribed from photos — **verify against the analyzer's printout**.
