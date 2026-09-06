#!/bin/bash
set -euo pipefail
# Pass the UUID of a booted iOS simulator. No app data or settings are changed.
device="${1:?Usage: bash test/ios-monet-checks.sh SIMULATOR_UUID}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
output="$(mktemp -d /tmp/biu-monet-checks.XXXXXX)"
trap 'rm -rf "$output"' EXIT
cat > "$output/Runner.swift" <<'SWIFT'
@main
struct Runner {
  static func main() { runMonetChecks() }
}
SWIFT
xcrun --sdk iphonesimulator swiftc -parse-as-library \
  -target "$(uname -m)-apple-ios16.4-simulator" \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  "$repo/mobile-rn/node_modules/expo-widgets/ios/Widgets/BiuMonetLyrics.swift" \
  "$repo/test/ios-monet-checks.swift" "$output/Runner.swift" -o "$output/checks"
xcrun simctl spawn "$device" "$output/checks"
