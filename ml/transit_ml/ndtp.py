"""Bounded NDTP 6.2 framing and default emulator cell parsing, per official specification."""

import asyncio
import struct
import time
from collections import deque

CELL_SIZES = {0: 26, 2: 26, 8: 6, 10: 37, 15: 50, 16: 8}


def crc16(data: bytes):
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return ((crc & 255) << 8) | (crc >> 8)


def parse_frame(frame: bytes):
    if len(frame) < 25:
        raise ValueError("Truncated frame")
    signature, size, flags, crc, kind, unit, _request = struct.unpack_from(
        "<HHHHBIH", frame
    )
    if signature != 0x7E7E or kind != 2 or flags != 0 or size != len(frame) - 15:
        raise ValueError("Invalid NPL header")
    if crc16(frame[15:]) != crc:
        raise ValueError("CRC mismatch")
    service, kind, flags, _request = struct.unpack_from("<HHHI", frame, 15)
    if service == 0 and kind == 100:
        if len(frame) != 43:
            raise ValueError("Invalid handshake length")
        major, minor, _, peer, _, _ = struct.unpack_from("<HHHIII", frame, 25)
        if (major, minor) != (6, 2) or peer != unit:
            raise ValueError("Invalid handshake")
        return {"unit_id": unit, "handshake": True}
    if (service, kind) != (1, 101):
        raise ValueError("Unsupported NPH")
    offset = 25
    nav = None
    while offset < len(frame):
        if offset + 2 > len(frame):
            raise ValueError("Truncated cell header")
        cell, _number = struct.unpack_from("<BB", frame, offset)
        offset += 2
        size = CELL_SIZES.get(cell)
        # Unknown cells carry no lengths. Reject safely instead of guessing byte alignment.
        if size is None:
            raise ValueError(f"Unsupported cell type {cell}")
        if offset + size > len(frame):
            raise ValueError("Truncated cell")
        if cell == 0:
            if nav is not None:
                raise ValueError("Duplicate navigation")
            (
                ts,
                lon,
                lat,
                flags,
                _bat,
                speed,
                _max_speed,
                heading,
                _track,
                alt,
                _nsat,
                _pdop,
            ) = struct.unpack_from("<IIIBBHHHHHBB", frame, offset)
            lon = lon / 1e7 * (1 if flags & 64 else -1)
            lat = lat / 1e7 * (1 if flags & 32 else -1)
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError("Invalid coordinates")
            nav = {
                "unit_id": unit,
                "ts": ts,
                "lon": lon,
                "lat": lat,
                "location_valid": bool(flags & 128),
                "speed": speed,
                "heading": heading,
                "alt": alt,
            }
        offset += size
    if nav is None:
        raise ValueError("Missing navigation")
    return nav


class Receiver:
    """Bounded per-unit histories and idle timeout; reconnecting clients retain last known state."""

    def __init__(self, max_units=1000, on_packet=None, allowed_units=None):
        self.histories = {}
        self.max_units = max_units
        self.on_packet = on_packet
        self.allowed_units = allowed_units
        self.frames = 0
        self.errors = 0
        self.connections = 0
        self.last_packet_at = None
        self.out_of_order_frames = 0
        self.stale_frames = 0
        self.ignored_units = 0

    async def handle(self, reader, writer):
        self.connections += 1
        try:
            while True:
                header = await asyncio.wait_for(reader.readexactly(15), timeout=60)
                size = struct.unpack_from("<H", header, 2)[0]
                if header[:2] != b"~~" or not 10 <= size <= 65535:
                    raise ValueError("Invalid frame size")
                body = await asyncio.wait_for(reader.readexactly(size), timeout=10)
                row = parse_frame(header + body)
                if row.get("handshake"):
                    continue
                unit = row["unit_id"]
                received_at = time.time()
                if row["ts"] > received_at + 60:
                    raise ValueError("Future telemetry timestamp")
                if self.allowed_units is not None and unit not in self.allowed_units:
                    # Count a valid but unmapped frame without letting arbitrary
                    # devices exhaust the bounded histories for mapped vehicles.
                    self.frames += 1
                    self.ignored_units += 1
                    self.last_packet_at = received_at
                    if self.on_packet is not None:
                        self.on_packet(row)
                    continue
                if unit not in self.histories and len(self.histories) >= self.max_units:
                    raise ValueError("Unit limit reached")
                history = self.histories.setdefault(unit, deque(maxlen=1500))
                if history and row["ts"] < history[-1]["ts"]:
                    # An old packet must not replace a newer live observation.
                    self.out_of_order_frames += 1
                    continue
                history.append(row)
                self.frames += 1
                self.stale_frames += row["ts"] < received_at - 180
                self.last_packet_at = received_at
                if self.on_packet is not None:
                    self.on_packet(row)
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        except (ValueError, TimeoutError):
            self.errors += 1
        finally:
            self.connections -= 1
            writer.close()
            try:
                await writer.wait_closed()
            except ConnectionError:
                pass

    def status(self):
        return {
            "frames": self.frames,
            "errors": self.errors,
            "connections": self.connections,
            "units": len(self.histories),
            "lastPacketAt": self.last_packet_at,
            "lastPacketAgeSec": round(max(0, time.time() - self.last_packet_at), 1)
            if self.last_packet_at is not None else None,
            "outOfOrderFrames": self.out_of_order_frames,
            "staleFrames": self.stale_frames,
            "ignoredUnits": self.ignored_units,
        }
