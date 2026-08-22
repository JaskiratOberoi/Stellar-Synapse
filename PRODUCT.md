# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron desktop app for Windows lab PCs; the renderer is a React 18 + Tailwind SPA. Desktop-only — no mobile breakpoints. Runs tray-resident in the background; window size is a normal desktop window.)

## Users

Lab engineers and Stellar's own integration team, primarily during instrument onboarding, mapping, and troubleshooting. Day-to-day the app runs minimized in the tray on a shared lab PC; it is opened deliberately when something needs setting up or fixing, not watched continuously. Secondary audience: prospective lab clients seeing the product during pitches/demos — the UI is part of the sales story for Stellar's interfacing platform.

## Product Purpose

Stellar Synapse is LIS instrument-integration middleware: it connects laboratory analyzers (Maglumi, MAGICL, Beckman, Mindray, Horiba, etc.) over TCP/serial, decodes ASTM/HL7/vendor protocols, maps analytes to LIS tests, and writes results into the Noble LISTEC LIS. Success = results flow from analyzer to LIS untouched by humans, and when they don't, the operator can see exactly where the pipeline broke.

## Positioning

A declarative driver catalog covering many analyzer families in one installable app, with LAN auto-discovery, per-lab presets, offline write queueing, and (since 0.2.99) realtime cloud telemetry to the Stellar Infinity platform. Competing lab middleware is typically per-instrument, vendor-supplied, and ugly; Synapse is one polished multi-vendor product.

## Operating Context

- Windows lab PCs, often shared, sometimes offline; the app must keep interfacing when the network or LIS is down.
- Core flow: Add instrument (driver + connection + preset) → auto-map analytes → watch Monitor/Logs while testing → leave running in tray.
- Since v0.2.99: Settings carries lab identity + Stellar Infinity cloud sync credentials; disconnect/stuck-connecting alerts fire as OS notifications.
- Version 0.3.0 ships a complete visual redesign (2026-08).

## Capabilities and Constraints

- Pages: Dashboard, Instruments (+detail), Discovery, Mapping, Monitor, LIS connection, Logs, Settings. Modals: add/edit instrument, mapping editor.
- Status vocabulary is load-bearing: online / offline / listening / error / connecting per instrument; LIS live/mock/read-only; cloud sync configured/error/last-sync.
- Stack constraints: React 18, Tailwind 3, framer-motion, lucide-react, recharts, zustand; Electron 31. No network-loaded assets at runtime (labs can be offline) — fonts must ship in the bundle.
- All existing features, flows, IPC contracts, and behavior must be preserved through any redesign (confirmed 2026-08-22).

## Brand Commitments

- Name: "Stellar Synapse"; part of the Stellar product family (Telo, Infinity, etc.).
- v0.3.0 visual direction is user-pinned (2026-08-22): the Vexto incident-response desktop aesthetic (Dribbble shot 27619812) — near-black calm monochrome, soft large-radius surfaces, pill navigation, ultralight display numerals, color reserved for status semantics.

## Evidence on Hand

- Real driver catalog, instrument names, protocols, and lab presets (haldwani/jammu/delhi/karnal/rohtak) exist in-repo — demo data can be truthful.
- Reference images cached this session: scratchpad vexto-ref.jpg / vexto-ref2.jpg.

## Product Principles

1. Interfacing never stops: no UI state may obscure or interrupt the pipeline.
2. Status is the product: connection state and pipeline stage must be legible at a glance, from across a room.
3. Diagnostic depth on demand: overview first, raw frames/logs one click away.
4. One system, many vendors: instruments from any vendor look and behave identically in the UI.
5. Polish is a sales asset: the app is shown to prospective labs; craft is part of positioning (confirmed: operator clarity and showcase weigh equally).
