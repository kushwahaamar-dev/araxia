import pytest

from bridge.hrs import DecodeError, decode


def test_fitbit_air_packet_16bit_no_contact():
    m = decode(bytes.fromhex("016d00"))
    assert m.bpm == 109
    assert m.contact_supported is False
    assert m.contact_detected is None
    assert m.energy_kj is None
    assert m.rr_ms == ()
    assert m.flags == 0x01


def test_8bit_bpm():
    m = decode(bytes.fromhex("0048"))
    assert m.bpm == 72


def test_contact_supported_detected():
    m = decode(bytes.fromhex("0648"))
    assert m.contact_supported is True and m.contact_detected is True


def test_contact_supported_not_detected():
    m = decode(bytes.fromhex("0448"))
    assert m.contact_supported is True and m.contact_detected is False


def test_energy_expended():
    m = decode(bytes.fromhex("08483412"))
    assert m.energy_kj == 0x1234


def test_rr_intervals_two():
    m = decode(bytes.fromhex("1048" + "0003" + "0004"))
    assert m.rr_ms == (750, 1000)


def test_16bit_with_energy_and_rr():
    m = decode(bytes.fromhex("19" + "7000" + "0a00" + "0003"))
    assert m.bpm == 112 and m.energy_kj == 10 and m.rr_ms == (750,)


@pytest.mark.parametrize(
    "hex_payload",
    ["", "01", "0148", "0848", "104800", "0048ff"],
)
def test_truncated_or_trailing_fails_closed(hex_payload):
    with pytest.raises(DecodeError):
        decode(bytes.fromhex(hex_payload))
