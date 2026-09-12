# Android HCI snoop (best full packet capture)

Mac BLE connect can dump GATT and live notifies, but the real Fitbit Air ↔ Google Health sync usually happens on the phone. Use Android HCI snoop for that.

## Enable

1. Developer options → **Enable Bluetooth HCI snoop log** (wording varies by OEM).
2. Toggle Bluetooth off/on once.
3. Open Google Health / Fitbit pairing sync with the Air nearby.
4. Reproduce heart-rate / activity sync for ~1–2 minutes.

## Pull the log

```bash
# Common paths (try in order):
adb pull /sdcard/btsnoop_hci.log ./btsnoop_hci.log
adb pull /data/misc/bluetooth/logs/btsnoop_hci.log ./btsnoop_hci.log

# Some Pixels / Android 12+:
adb bugreport bugreport.zip
# then extract FS/data/misc/bluetooth/logs/btsnoop_hci.log from the zip
```

## Inspect

```bash
wireshark btsnoop_hci.log
# Useful filters:
#   btle
#   btatt
#   bthci_acl
```

Drop the `.log` into `rice/capture/` and keep notes of which sync action produced which packets.
