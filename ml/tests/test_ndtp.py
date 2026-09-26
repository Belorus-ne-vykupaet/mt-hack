import asyncio
import struct
import time

import pytest
from transit_ml.ndtp import Receiver, crc16, parse_frame


def frame(body, service=1, kind=101):
    nph = struct.pack("<HHHI", service, kind, 1, 1) + body
    return struct.pack("<HHHHBIH", 0x7E7E, len(nph), 0, crc16(nph), 2, 123, 0) + nph


def nav(timestamp=None):
    return bytes([0, 0]) + struct.pack(
        "<IIIBBHHHHHBB",
        int(time.time()) if timestamp is None else timestamp,
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


def test_official_irma_door_cell():
    # 15-byte layout confirmed against the organizers' emulator image:
    # odometer u32, zone u16, four in/out u8 counters and one flag byte.
    base = nav() + bytes([4, 0]) + struct.pack(
        "<IH4B4BB", 4660, 3, 123, 0, 0, 0, 45, 0, 0, 0, 0x23
    )
    assert parse_frame(frame(base))["doors_open"] is True
    closed = nav() + bytes([4, 0]) + struct.pack(
        "<IH4B4BB", 4660, 3, 123, 0, 0, 0, 45, 0, 0, 0, 0x33
    )
    assert parse_frame(frame(closed))["doors_open"] is False
    assert parse_frame(frame(nav()))["doors_open"] is None
    absent = nav() + bytes([4, 0]) + bytes(15)
    assert parse_frame(frame(absent))["doors_open"] is None


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
        received = []
        receiver = Receiver(on_packet=received.append)
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
            and len(received) == 3
        )

    asyncio.run(run())


def test_old_packet_does_not_replace_latest_position_and_bad_crc_is_counted():
    async def run():
        received = []
        receiver = Receiver(on_packet=received.append)
        server = await asyncio.start_server(receiver.handle, "127.0.0.1", 0)
        async with server:
            port = server.sockets[0].getsockname()[1]
            _, writer = await asyncio.open_connection("127.0.0.1", port)
            current = int(time.time())
            bad = bytearray(frame(nav(current)))
            bad[-1] ^= 1
            writer.write(frame(nav(current)) + frame(nav(current - 200)) + bad)
            await writer.drain()
            await asyncio.sleep(0.05)
            writer.close()
            await writer.wait_closed()
            await asyncio.sleep(0.02)
        assert receiver.frames == 1
        assert receiver.out_of_order_frames == 1
        assert receiver.errors == 1
        assert len(received) == 1
        assert receiver.histories[123][-1]["ts"] == current
        assert receiver.status()["lastPacketAgeSec"] is not None

    asyncio.run(run())


def test_unmapped_unit_is_counted_without_consuming_history_capacity():
    async def run():
        received = []
        receiver = Receiver(max_units=1, on_packet=received.append,
                            allowed_units={456})
        server = await asyncio.start_server(receiver.handle, "127.0.0.1", 0)
        async with server:
            _, writer = await asyncio.open_connection(
                "127.0.0.1", server.sockets[0].getsockname()[1]
            )
            writer.write(frame(nav()))  # Header unit_id=123 is unmapped.
            await writer.drain()
            await asyncio.sleep(0.03)
            writer.close()
            await writer.wait_closed()
            await asyncio.sleep(0.02)
        assert receiver.frames == 1 and receiver.ignored_units == 1
        assert receiver.histories == {}
        assert len(received) == 1

    asyncio.run(run())


def test_sparse_history_expires_by_time_and_last_position_survives_reconnect():
    async def run():
        receiver = Receiver()
        received = asyncio.Event()
        receiver.on_packet = lambda _: received.set() if receiver.frames >= 33 else None
        server = await asyncio.start_server(receiver.handle, "127.0.0.1", 0)
        current = int(time.time())
        async with server:
            port = server.sockets[0].getsockname()[1]
            _, writer = await asyncio.open_connection("127.0.0.1", port)
            # Sparse one-minute data never reaches the 1500-packet count cap.
            writer.write(b"".join(frame(nav(current - 1860 + i * 60)) for i in range(32)))
            await writer.drain()
            writer.close()
            await writer.wait_closed()
            _, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(frame(nav(current + 1)))
            await writer.drain()
            await asyncio.wait_for(received.wait(), 1)
            writer.close()
            await writer.wait_closed()
        history = receiver.histories[123]
        assert history[0]["ts"] >= current + 1 - 1800
        assert history[-1]["ts"] == current + 1
        assert receiver.frames == 33 and receiver.errors == 0
        assert receiver.status()["historyPackets"] == 31

    asyncio.run(run())
