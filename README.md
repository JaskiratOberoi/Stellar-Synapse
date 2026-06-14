# Stellar Synapse

**Modular LIS instrument integration middleware** for laboratory analyzers.

Stellar Synapse is a Windows desktop application that sits between lab analyzers
(SNIBE Maglumi X3, Getein MAGICL 6000, Beckman Coulter DxH, ...) and the
**Noble LISTEC** Laboratory Information System. It receives results from
instruments over the network (or serial), decodes the instrument protocol
(ASTM / HL7), maps each analyte to the correct LIS test/parameter - with manual
override - and writes the result into the LIS database.

> **Scaffold phase:** this build ships the full UI and a complete, pluggable
> backend skeleton driven by a built-in **instrument simulator** and **mock LIS
> data**. There are no live instrument connections and **no writes to the
> production Noble database** yet (live SQL is intentionally disabled).

---

## Architecture

```
Analyzer ─▶ Transport ─▶ Protocol ─▶ Driver ─▶ CanonicalResult ─▶ Mapping ─▶ LIS Repository ─▶ Noble DB
          (TCP/Serial)  (ASTM/HL7)  (normalize)                 (+override)  (Mock now / SQL later)
```

Each stage is an interface-driven, swappable module:

| Stage | Interface | Implementations |
|---|---|---|
| Transport | `ITransport` | `TcpServer` (middleware listens; analyzer connects in), `SerialTransport` (stub) |
| Protocol | `IProtocol` | `AstmProtocol` (E1381 framing + E1394 records), `Hl7Protocol` (v2.x over MLLP) |
| Driver | `IInstrumentDriver` | `maglumi-x3`, `magicl-6000`, `beckman-coulter`, `generic-astm` |
| Mapping | `MappingEngine` | code/name auto-suggest + persisted manual overrides |
| LIS | `ILisRepository` | `MockLisRepository` (default), `SqlLisRepository` (SQL Server, disabled) |

The `Orchestrator` wires these together per instrument and emits runtime state
and a live monitor event stream to the UI over a typed IPC bridge.

### Why the middleware is a TCP **server**

Research of the analyzer manuals (e.g. Beckman Coulter DxH host transmission
manual) shows the **analyzer acts as the TCP client** and dials out to the LIS
host. Stellar Synapse therefore **listens** on a port per instrument.

### LIS data flow (Noble schema)

- Write target: `tbl_med_mcc_patient_test_result`
  (`vailid`, `testid`, `paramid`, `value`, `testunit`, `abnormal`, `machine_name`, `UploadFlag`)
- Order lookup (host query): `tbl_med_mcc_patient_samples` (keyed by `vailid`)
- Mapping catalog: `tbl_med_test_master` + `tbl_med_parameter_master`

---

## Project structure

```text
src/
├── main/                      Electron main process (Node backend)
│   ├── core/
│   │   ├── connection/        ITransport, TcpServer, SerialTransport, factory
│   │   ├── protocols/         IProtocol, astm, hl7, registry
│   │   ├── drivers/           IInstrumentDriver + per-model drivers + registry
│   │   ├── mapping/           MappingEngine (auto-suggest + override)
│   │   ├── lis/               ILisRepository, Mock + SQL repos, mock catalog
│   │   ├── simulator/         Instrument traffic simulator
│   │   ├── engine/            Orchestrator (wires the pipeline)
│   │   └── logger.ts
│   ├── ipc/                   Typed IPC handlers + event forwarding
│   ├── store.ts               electron-store persistence
│   └── index.ts               App entry, window, first-run seeding
├── preload/                   contextBridge -> window.api
├── shared/                    types.ts + ipc.ts (shared contract)
└── renderer/                  React UI (Vite)
    └── src/
        ├── components/        ui/ primitives, layout, modals
        ├── pages/             Dashboard, Instruments, Mapping, Monitor, LIS, Logs, Settings
        ├── store/             Zustand store (subscribes to live IPC events)
        └── styles/            Tailwind design system
```

---

## UI screens

- **Dashboard** - online instruments, results-today, mapped analytes, errors, a
  12-hour throughput chart, and a live activity feed.
- **Instruments** - status cards with counters + an "Add Instrument" wizard that
  reads the driver catalog. Start/stop each instrument.
- **Instrument Detail** - connection + protocol options, host-query toggle, a
  live channel log, and an "Emit Test Sample" button.
- **Mapping** - the centerpiece: a table of every instrument analyte mapped to a
  LIS test/parameter, with status (auto/manual/unmapped/ignored), filtering,
  bulk **Auto-map**, and an inline editor with a searchable LIS catalog picker
  for **manual overrides**.
- **Live Monitor** - real-time decoded stream with parsed/raw views, pause,
  per-instrument and per-stage filters, and a message-detail panel.
- **LIS Connection** - Noble SQL Server settings, "Test connection", live-mode
  toggle, and a recent-writes panel.
- **Logs / Settings** - filterable system log; simulator and mapping preferences.

---

## Getting started

```bash
npm install      # already done if you are reviewing
npm run dev      # launch the app + Vite dev server (hot reload)
```

Other scripts:

```bash
npm run typecheck   # tsc for main + renderer
npm run build       # typecheck + bundle (electron-vite)
npm run build:win   # Windows package (electron-builder config to be added)
```

On first run the app seeds three example instruments (two enabled) and the
simulator begins emitting results, so every screen is immediately populated.

---

## Adding support for a new analyzer

1. Create `src/main/core/drivers/<model>.ts` implementing `IInstrumentDriver`
   (advertise `info`, `analytes()`, `parse()`, `buildSample()`).
2. Register it in `src/main/core/drivers/registry.ts`.

That is all - the new driver automatically appears in the "Add Instrument"
catalog and seeds the Mapping screen. If the analyzer speaks a protocol not yet
covered, add an `IProtocol` implementation and register it in
`src/main/core/protocols/registry.ts`.

---

## Going live (next phase)

1. **Database**: set `live: true` in LIS Connection and implement the queries in
   `SqlLisRepository` (reference SQL is documented in that file). Swap
   `MockLisRepository` for `SqlLisRepository` in `src/main/index.ts`.
2. **Instruments**: connect real analyzers; harden ASTM checksum/retransmit and
   HL7 ACK handling; implement live serial I/O in `SerialTransport` (lazy-loads
   the optional `serialport` dependency).
3. **Instrument specifics**: confirm field layouts against each vendor's
   interface spec (notably the MAGICL 6000).

> The production Noble connection (`nobleone@122.161.198.159`) contains real
> patient data. Keep live mode off until you intend to write to it.
