# Project Context

## Overview

This Expo 57 companion manages family PineTime watches across Android, web, and
desktop. Implementation commit `fc7c187` contains the multi-companion pairing
and connection work.

## Architecture

- Transport seam: `src/ble/transport.ts`.
- Per-watch ownership: `src/ble/connectionCoordinator.ts`.
- Pairing contract and flow: `companionManagementProtocol.ts` and
  `companionPairing.ts`.
- Repair diagnosis: `repairAdvice.ts`.
- Error UX: `transportError.ts` and `watchOpError.ts`.
- Native forwarding ownership and bond helpers:
  `modules/notification-forwarder/`.

## Tech Stack

Expo 57, React Native 0.86, TypeScript 6, Web Bluetooth, react-native-ble-plx,
Kotlin/Android public Bluetooth APIs, and Node test runner.

## Invariants

- Selecting a device never saves it before authenticated verify.
- A 5/5 watch asks before the authenticated sixth-peer pairing.
- Forwarding pause failure aborts before connecting.
- Every acquired forwarding pause is released after disconnect/cleanup.
- Busy is not described as a pairing problem.
- Remove from app does not claim to remove the OS or watch bond.
- Repair uses system settings; no hidden `removeBond` reflection.
- Older firmware requires an explicit unverified legacy confirmation.
- InfiniTime 2.0.2 imports no previous bond format; all companions pair once
  after the major-version cutover.
- UpdateScreen removal is blocked during transfer; duplicate starts are guarded
  synchronously rather than relying only on rendered React state.

## Key Decisions

| Decision | Rationale | Date |
|---|---|---|
| Watch data remains authoritative during family handoff | Independent companions converge through one watch | 2026-08-04 |
| Store reset/eviction metadata after verify | Diagnose broken bonds without guessing | 2026-08-04 |
| Notification forwarding remains exclusive | PineTime supports one active link | 2026-08-04 |
