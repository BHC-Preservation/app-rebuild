#!/usr/bin/env python3
"""Make removeTask a no-op for a task that is not queued (Colonies 1.3.13 index.min.js).

removeTask (deob 7616.js ~l. 1420) does

    var i = taskArray.findIndex(t => t === name); return taskArray.splice(i, 1);

with no check for -1, and splice(-1, 1) drops the *last* queued task. After connecting, the queue ends with
check-firmware-task followed by exit-initial-loop-task (3488.js ~l. 2285). firmwareRouter (3488.js ~l. 1626)
awaits fw_status and fw_app before it removes the firmware task, and meanwhile the unlocked queue sends the
firmware query again. Both answers run the router, and the second removeTask(firmware) then removes
exit-initial-loop-task. exitConnectArcScreen never runs and the status line stays at "synchronizing with ARC".
This happens whenever the publisher API answers slower than the ARC (e.g. --api=<URL>).
The patch returns [] when the task is not in the queue, the same as splice() with nothing removed.

Usage: python3 -I patches/task_queue.py <path/to/index.min.js>
"""
import sys

OLD = "return _0x652534['Z'][_0x1e4e62(0x15ec)]['taskArray'][_0x1e4e62(0xfd6)](_0x4692e4,0x1);}"
NEW = "return _0x4692e4<0x0?[]:_0x652534['Z'][_0x1e4e62(0x15ec)]['taskArray'][_0x1e4e62(0xfd6)](_0x4692e4,0x1);}"

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
n = src.count(OLD)
if n != 1:
    sys.exit(f"task_queue: expected exactly 1 occurrence, found {n} (already patched or different app version?)")
open(path, "w", encoding="utf-8").write(src.replace(OLD, NEW))
print("task_queue: removeTask no longer drops the last task for a missing one")
