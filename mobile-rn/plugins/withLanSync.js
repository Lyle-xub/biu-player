const { withAndroidManifest, withInfoPlist, AndroidConfig } = require('expo/config-plugins');

module.exports = function withLanSync(config) {
  config = withAndroidManifest(config, (mod) => {
    // Android cannot express private-IP ranges as domain exceptions. The sync
    // client restricts every destination to a manually entered local IPv4 address.
    AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults).$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.NSLocalNetworkUsageDescription = '连接同一局域网内的 Biu Player 电脑端，手动同步我喜欢和歌单。';
    mod.modResults.NSAppTransportSecurity = { ...mod.modResults.NSAppTransportSecurity, NSAllowsLocalNetworking: true };
    return mod;
  });
};
