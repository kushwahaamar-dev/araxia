# Fitbit Air hardware gate: measured facts

Device: Google Fitbit Air, model 67, firmware 67.20001.253.2. Host: macOS,
Python bleak, CoreBluetooth. All numbers below come from the captures in this
directory (`hr_*.jsonl`, `gatt_sharing_on.json`, `gate_worn_all.log`).

## What the band exposes over Bluetooth

| Item | Result |
|---|---|
| Heart Rate Service `0x180D` / `0x2A37` | Present. Notify only. |
| Packet format | Always `01 <bpm_lo> <bpm_hi>`. Flags byte is `0x01` in 100% of 426 packets. |
| BPM | 16-bit little-endian, 1 Hz cadence (median 1.019 s, max gap 1.055 s). Value changes at most every 2 s (each reading is sent twice). |
| RR intervals | Never present (flag bit 4 clear in every packet). No beat-to-beat data. |
| Skin contact bit | Reported as unsupported (bits 1-2 = 00). The band never signals on/off wrist. |
| Energy expended | Never present. |
| Body Sensor Location `0x2A38` | Characteristic does not exist. |
| Battery Service `0x180F` | Does not exist. |
| Proprietary services `abbafd00`, `abbaff00`, `ac2f0045`, `4eee1c00` | Unchanged with sharing on. `abbafd01`/`abbafd02` emit one static packet on subscribe and nothing after. `4eee1c03` read returns app error `0x85`. Encrypted/authenticated sync channel; not usable. |

Conclusion: the only sensory signal available is a smoothed BPM integer at
0.5 Hz effective rate. There is no rhythm waveform, no inter-beat timing, no
temperature, no motion, no contact flag. Any "identity" claim must be built on
the BPM time series alone and must be described as a behavioural continuity
model, not a biometric fingerprint.

## How to get the stream (demo runbook)

1. Google Health app: Connections -> Fitbit Air -> Share heart rate -> ON, and
   "Always visible" -> ON.
2. Band starts advertising `0x180D` (visible in `scan_ble.py` as `svc=180d`).
   Before sharing is on it advertises only Fitbit vendor UUID `fd62`.
3. Connect and subscribe. The first ever connection streams nothing until the
   user taps "Get started" / confirms in the app while the central is
   connected (data began 50 s into `hr_worn_4`, right after the confirm).
   Unconfirmed connections are dropped by the band after ~120-126 s.
4. After that one-time confirm, every reconnect streams immediately
   (`hr_offwrist` first packet at 8.6 s, `hr_rewear` at 3.8 s) with no phone
   interaction. CCCD write is accepted (reads back `0100`).
5. macOS cannot initiate a BLE bond from code (`Pairing is not available in
   Core Bluetooth`); none was needed.

## Off-wrist behaviour (the finding that shapes presence detection)

| State | Behaviour |
|---|---|
| Worn, connected | BPM varies. Longest run of identical values in 191 packets: 7 packets (~7 s). Typical 2-4. Step sizes 1-6 BPM. |
| Removed while connected | Stream does NOT stop. Band keeps sending the last value (112) at 1 Hz, frozen, for the entire 167-packet remainder of the capture. No flag change, no zero, no disconnect. |
| Removed, then central disconnects | Band stops advertising entirely (not even `fd62`). Scans find nothing. |
| Re-worn | Re-advertises `0x180D` within seconds, no phone action. Stream resumes; the first ~21 s still carry the stale frozen value, then live values return. |
| Worn, calm, seated | Plateaus of one value up to 15 s observed. |

A naive "packets are arriving, therefore a human is wearing it" check is
defeated by a band lying on a desk. Presence must be defined by variation.

## Frozen thresholds for the Araxia bridge

Derived from the captures above; all margins are against the worst worn case
(21 s identical) versus the off-wrist case (167 s and still frozen).

- `READY`: connected, and at least 2 distinct BPM values observed within the
  last 30 s, and last packet age < 3 s.
- `WARMING`: connected but READY condition not yet met (covers the ~21 s stale
  carry-over after re-wear and the settle period after connect).
- `STALE`: last packet age >= 3 s, or the same BPM value for >= 8 s
  (just above the longest worn identical run we measured; off-wrist freezes
  forever, so this is what makes unwrap → handoff feel fast).
  STALE can only deny or step up to passkey re-verification; it never
  approves at AAL3.
- `DISCONNECTED`: no packet for >= 10 s or link lost.
- Plausibility bounds: 30 <= bpm <= 220. Anything else is treated as STALE.
- Presence is checked at approval time and again immediately before
  execution; both must be READY for AAL3.

## What this means for the "identity from heart rhythm" claim

Available features per user, over a session: BPM level (robust mean/MAD),
short-horizon variability (rate of change per 2 s step, plateau lengths),
and response shape to a prompt (how fast BPM moves after a stimulus). These
are enough for an adaptive continuity model that flags "this does not look
like the enrolled wearer's recent pattern" and forces step-up. They are not
enough to identify a person among many, and the packets carry nothing that
would make that possible. The pitch must say "continuity of the same wearer
since passkey verification", never "your heartbeat is your password".
