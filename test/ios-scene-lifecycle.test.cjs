const assert = require('node:assert/strict');
const { test } = require('node:test');
const { migrateAppDelegate } = require('../mobile-rn/plugins/withSceneLifecycle');

test('Expo prebuild moves startup into the scene without removing linking or duplicating migration', () => {
  const source = `class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  func launch() {
#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
  // Linking API
}
class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {}
`;
  const migrated = migrateAppDelegate(source);
  assert.equal(migrateAppDelegate(migrated), migrated);
  assert.ok(!migrated.includes('UIWindow(frame:'));
  assert.ok(migrated.includes('initialLaunchOptions = launchOptions'));
  assert.ok(migrated.includes('UIWindow(windowScene: windowScene)'));
  assert.ok(migrated.includes('return super.application(application, didFinishLaunchingWithOptions: launchOptions)'));
  assert.ok(migrated.includes('// Linking API'));
  assert.equal(migrated.match(/factory.startReactNative\(/g).length, 1);
  assert.throws(() => migrateAppDelegate('changed Expo template'), /template changed/);
});
