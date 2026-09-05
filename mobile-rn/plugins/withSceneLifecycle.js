const fs = require('node:fs');
const path = require('node:path');
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

function migrateAppDelegate(source) {
  if (source.includes('// Biu scene lifecycle')) return source;
  const windowProperty = '  var window: UIWindow?';
  const legacyStartup = /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?factory\.startReactNative\([\s\S]*?launchOptions: launchOptions\)\s*#endif/;
  if (!source.includes(windowProperty) || !legacyStartup.test(source)) {
    throw new Error('Expo AppDelegate template changed; review the scene lifecycle migration.');
  }
  return source
    .replace(windowProperty, `${windowProperty}\n  var initialLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?`)
    .replace(legacyStartup, '    initialLaunchOptions = launchOptions')
    + '\n' + fs.readFileSync(path.join(__dirname, 'SceneDelegate.swift'), 'utf8');
}

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: 'Default Configuration',
          UISceneClassName: 'UIWindowScene',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        }],
      },
    };
    return mod;
  });
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') throw new Error('Biu scene lifecycle requires Swift AppDelegate.');
    mod.modResults.contents = migrateAppDelegate(mod.modResults.contents);
    return mod;
  });
};

module.exports.migrateAppDelegate = migrateAppDelegate;
