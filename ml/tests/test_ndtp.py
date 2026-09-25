import asyncio
import struct
import time

import pytest
from transit_ml.ndtp import Receiver, crc16, parse_frame


def frame(body, service=1, kind=101):
    nph = struct.pack("<HHHI", service, kind, 1, 1) + body
    return struct.pack("<HHHHBIH", 0x7E7E, len(nph), 0, crc16(nph), 2, 123, 0) + nph


def nav():
    return bytes([0, 0]) + struct.pack(
        "<IIIBBHHHHHBB",
        int(time.time()),
        376173210,
        557551234,
        224,
        100,
        30,
        35,
        90,
        100,
        150,
        8,
        1,
    )


def test_navigation_and_default_cells():
    packet = frame(
        nav()
        + bytes([2, 0])
        + bytes(26)
        + bytes([8, 0])
        + bytes(6)
        + bytes([10, 0])
        + bytes(37)
        + bytes([16, 0])
        + bytes(8)
    )
    row = parse_frame(packet)
    assert row["lon"] == pytest.approx(37.617321) and row["lat"] == pytest.approx(
        55.7551234
    )
    assert row["speed"] == 30 and row["location_valid"]


def test_crc_handshake_and_unknown_cells():
    assert (
        crc16(b"123456789") == 0x374B
    )  # Known Modbus vector 0x4b37 with required byte swap.
    packet = bytearray(frame(nav()))
    packet[-1] ^= 1
    with pytest.raises(ValueError, match="CRC"):
        parse_frame(packet)
    handshake = frame(struct.pack("<HHHIII", 6, 2, 0, 123, 65535, 0), 0, 100)
    assert parse_frame(handshake)["handshake"]
    with pytest.raises(ValueError, match="Unsupported cell"):
        parse_frame(frame(nav() + bytes([99, 0])))
    with pytest.raises(ValueError, match="Truncated cell"):
        parse_frame(frame(nav()[:-1]))


def test_tcp_fragmentation_multiple_frames_and_reconnect():
    async def run():
        receiver = Receiver()
        server = await asyncio.start_server(receiver.handle, "127.0.0.1", 0)
        async with server:
            port = server.sockets[0].getsockname()[1]
            _, writer = await asyncio.open_connection("127.0.0.1", port)
            packet = frame(nav())
            writer.write(packet[:5])
            await writer.drain()
            await asyncio.sleep(0.01)
            writer.write(packet[5:] + packet)
            await writer.drain()
            await asyncio.sleep(0.03)
            writer.close()
            await writer.wait_closed()
            _, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(packet)
            await writer.drain()
            await asyncio.sleep(0.03)
            writer.close()
            await writer.wait_closed()
            await asyncio.sleep(0.02)
        assert (
            receiver.frames == 3
            and receiver.errors == 0
            and len(receiver.histories[123]) == 3
        )

    asyncio.run(run())
