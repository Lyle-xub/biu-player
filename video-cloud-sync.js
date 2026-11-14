const core = require('./renderer/video-cloud-sync-core');
const platform = { fs: require('node:fs'), path: require('node:path'), crypto: require('node:crypto'), Buffer };
const protocol = core(platform);

module.exports = { ...protocol, createVideoCloudSync(options) {
  return (options.compute ? core({ ...platform, compute: options.compute }) : protocol).createVideoCloudSync(options);
} };
