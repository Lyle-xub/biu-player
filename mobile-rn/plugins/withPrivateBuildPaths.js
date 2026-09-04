const { withProjectBuildGradle } = require('expo/config-plugins');

module.exports = function withPrivateBuildPaths(config) {
  return withProjectBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('// Biu: private native build paths')) {
      mod.modResults.contents += `
// Biu: private native build paths
subprojects { biuProject ->
  ['com.android.application', 'com.android.library'].each { biuPlugin ->
    biuProject.plugins.withId(biuPlugin) {
      def biuBuildHome = System.getProperty('user.home').replace('\\\\', '/')
      biuProject.android.defaultConfig.externalNativeBuild.cmake {
        cppFlags "-ffile-prefix-map=\${biuBuildHome}=/build"
        cFlags "-ffile-prefix-map=\${biuBuildHome}=/build"
      }
    }
  }
}
`;
    }
    return mod;
  });
};
