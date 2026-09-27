# GoldOS Barcode System

Status: reserved for a later phase (no code in Phase 1).

## ID formats (reserved prefixes)

- Products: `PRD-`
- Old-gold lots: `OLD-`
- Melting batches: `MLT-`
- Manufacturing jobs: `MFG-`
- Repairs: `REP-`

## Requirements (when implemented)

- Barcode generation + printable product labels.
- Camera scanning in the web app plus USB/Bluetooth scanner support
  (scanners act as keyboard input — POS inputs must accept rapid keystroke
  entry with an Enter terminator).
- Every process barcode (old gold, melting, manufacturing, repair) links back
  to its gold-ledger and audit entries so each gram stays traceable.
