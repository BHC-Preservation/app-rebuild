#!/usr/bin/env python3
"""Show the scenarios menu (Colonies 1.3.13 index.min.js).

The global config (deob 9073.js ~l. 208) has `_scenariosEnabled: false`, and the main menu
(deob 8736.js ~l. 5189) only shows the "scenarios" entry when it is true. The scenario code is
otherwise complete. This patch flips the flag and nothing else: the picker still lists only the
scenarios the publisher marked as available (deob 5183.js, `isAvailable`), and `_debug` stays off.

The obfuscated bundle has the config object twice (the second copy is the obfuscator's
dead-code duplicate), so both are changed.

Usage: python3 -I patches/scenarios.py <path/to/index.min.js>
"""
import sys

OLD = "'_scenariosEnabled':!0x1"
NEW = "'_scenariosEnabled':!0x0"

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
n = src.count(OLD)
if n != 2:
    sys.exit(f"scenarios: expected exactly 2 occurrences, found {n} (already patched or different app version?)")
open(path, "w", encoding="utf-8").write(src.replace(OLD, NEW))
print("scenarios: scenarios menu enabled")
