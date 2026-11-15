#!/usr/bin/env python3
"""Let the fleet picker honour the ARC's fleet table (Colonies 1.3.13 index.min.js).

The Fleet constructor (deob 881.js ~l. 656) only keeps `isAvail` in debug builds:

    if (Z._debug) this.isAvail = isAvail; else this.isAvail = false;

so a release build shows every fleet as inactive and only "no fleet" can be picked,
even though the ARC reports fleets as available (`01 01 04 01`, value 2 = available;
FW 1.0.23 ships with fleets 1-10 unlocked). This patch drops the `_debug` check and
nothing else: the availability still comes from the ARC, and the selected fleet goes
into the new-game frame through the app's normal code path (fleetBuffer.hex).

Usage: python3 -I patches/fleet_gate.py <path/to/index.min.js>
"""
import sys

OLD = "_0x2b84f8['Z'][_0x103391(0x202b)]?this[_0x103391(0x709)]=_0x45c5c6:this[_0x103391(0x709)]=!0x1"
NEW = "this[_0x103391(0x709)]=_0x45c5c6"

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
n = src.count(OLD)
if n != 1:
    sys.exit(f"fleet_gate: expected exactly 1 occurrence, found {n} (already patched or different app version?)")
open(path, "w", encoding="utf-8").write(src.replace(OLD, NEW))
print("fleet_gate: fleet availability now comes from the ARC")
