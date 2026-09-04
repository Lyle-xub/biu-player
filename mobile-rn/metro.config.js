const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
require('./scripts/build-split.cjs')();
// Pure JS sync format is shared with the packaged Electron renderer.
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../renderer')];
module.exports = config;
