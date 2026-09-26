"""Separate-process NDTP load: N devices, one frame per second each.

Runs outside the server's process so a busy server cannot slow the sender
down and hide a backlog. Logs (unit, seq, wall-clock send time) as JSON lines.

    python ndtp_load.py PORT SECONDS UNITS_JSON LOG_PATH
"""

import json
import socket
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from criteria_helpers import nav_frame  # noqa: E402


def main(port, seconds, units, log_path):
    sockets = [socket.create_connection(("127.0.0.1", port)) for _ in range(min(10, len(units)))]
    groups = [units[i::len(sockets)] for i in range(len(sockets))]
    started = time.time()
    seq = 0
    with open(log_path, "w", encoding="utf-8") as log:
        while time.time() - started < seconds:
            seq += 1
            beat = time.time()
            for sock, group in zip(sockets, groups):
                now = time.time()
                sock.sendall(b"".join(
                    nav_frame(unit, now, lon, lat, speed=0, altitude=seq) for unit, lon, lat in group
                ))
                for unit, _, _ in group:
                    log.write(json.dumps([unit, seq, now]) + "\n")
            time.sleep(max(0.0, 1.0 - (time.time() - beat)))
    time.sleep(1)
    for sock in sockets:
        sock.close()


if __name__ == "__main__":
    main(int(sys.argv[1]), float(sys.argv[2]), json.loads(Path(sys.argv[3]).read_text()), sys.argv[4])
