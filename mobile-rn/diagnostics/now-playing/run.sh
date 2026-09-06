#!/bin/bash
set -eu
probe_device=${1:?Usage: bash run.sh SIMULATOR_UDID}
probe_source_dir=$(cd "$(dirname "$0")" && pwd)
probe_output=$(mktemp -d /tmp/biu-media-probe.XXXXXX)
probe_app="$probe_output/NowPlayingProbe.app"
mkdir -p "$probe_app"
python3 - "$probe_app" <<'PY'
from pathlib import Path
import sys, plistlib, wave, math, struct
p = Path(sys.argv[1])
(p / 'Info.plist').write_bytes(plistlib.dumps({
    'CFBundleIdentifier': 'com.biuplayer.nowplayingprobe',
    'CFBundleExecutable': 'NowPlayingProbe', 'CFBundleName': 'NowPlayingProbe',
    'CFBundleDisplayName': '媒体控件诊断', 'CFBundlePackageType': 'APPL',
    'CFBundleVersion': '1', 'CFBundleShortVersionString': '1',
    'MinimumOSVersion': '16.4', 'LSRequiresIPhoneOS': True,
    'UIBackgroundModes': ['audio'], 'UILaunchScreen': {},
}))
with wave.open(str(p / 'tone.wav'), 'wb') as wav:
    wav.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
    wav.writeframes(b''.join(struct.pack('<h', int(1000 * math.sin(2 * math.pi * 220 * i / 22050)))
                            for i in range(22050 * 120)))
PY
probe_sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun --sdk iphonesimulator swiftc "$probe_source_dir/Probe.swift" -parse-as-library \
  -sdk "$probe_sdk" -target arm64-apple-ios16.4-simulator -o "$probe_app/NowPlayingProbe"
codesign --force --sign - --identifier com.biuplayer.nowplayingprobe "$probe_app"
xcrun simctl install "$probe_device" "$probe_app"
xcrun simctl launch "$probe_device" com.biuplayer.nowplayingprobe
printf 'Diagnostic app: %s\n' "$probe_app"
