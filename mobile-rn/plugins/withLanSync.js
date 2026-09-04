const { withAndroidManifest, withInfoPlist, AndroidConfig } = require('expo/config-plugins');

module.exports = function withLanSync(config) {
  config = withAndroidManifest(config, (mod) => {
    // Android cannot express private-IP ranges as domain exceptions. The sync
    // client restricts every discovered destination to a local IPv4 address.
    AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults).$['android:usesCleartextTraffic'] = 'true';
    AndroidConfig.Permissions.ensurePermissions(mod.modResults, [
      'android.permission.ACCESS_NETWORK_STATE', 'android.permission.ACCESS_WIFI_STATE',
      'android.permission.CHANGE_WIFI_MULTICAST_STATE',
    ]);
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.NSLocalNetworkUsageDescription = '自动发现同一局域网内登录相同账号的 Biu Player 电脑端，同步我喜欢和歌单。';
    mod.modResults.NSBonjourServices = [...new Set([...(mod.modResults.NSBonjourServices || []), '_biu-sync._tcp'])];
    mod.modResults.NSAppTransportSecurity = { ...mod.modResults.NSAppTransportSecurity, NSAllowsLocalNetworking: true };
    return mod;
  });
};
