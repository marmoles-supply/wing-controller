const fs = require('node:fs/promises');
const path = require('node:path');

const { CodeGenerator, withDangerousMod, withMainApplication } = require('expo/config-plugins');

const EXPECTED_ANDROID_PACKAGE = 'com.usuario.wingcontroller';
const NATIVE_SOURCE_DIR = 'native/wing-osc/android';
const NATIVE_FILES = ['WingOscModule.kt', 'WingOscPackage.kt'];

const withWingOscFiles = (config) => withDangerousMod(config, [
  'android',
  async (modConfig) => {
    const sourceDir = path.join(modConfig.modRequest.projectRoot, NATIVE_SOURCE_DIR);
    const destinationDir = path.join(
      modConfig.modRequest.platformProjectRoot,
      'app/src/main/java',
      ...EXPECTED_ANDROID_PACKAGE.split('.'),
    );
    await fs.mkdir(destinationDir, { recursive: true });
    await Promise.all(NATIVE_FILES.map((fileName) => (
      fs.copyFile(path.join(sourceDir, fileName), path.join(destinationDir, fileName))
    )));
    return modConfig;
  },
]);

const withWingOscRegistration = (config) => withMainApplication(config, (modConfig) => {
  if (modConfig.modResults.language !== 'kt') {
    throw new Error('WingOscModule requires a Kotlin MainApplication.');
  }
  if (modConfig.modResults.contents.includes('add(WingOscPackage())')) return modConfig;

  const merged = CodeGenerator.mergeContents({
    src: modConfig.modResults.contents,
    comment: '          //',
    tag: 'wing-osc-package',
    anchor: /PackageList\(this\)\.packages\.apply \{/,
    offset: 1,
    newSrc: '          add(WingOscPackage())',
  });
  modConfig.modResults.contents = merged.contents;
  return modConfig;
});

module.exports = (config) => {
  if (config.android?.package !== EXPECTED_ANDROID_PACKAGE) {
    throw new Error(`with-wing-osc expects Android package ${EXPECTED_ANDROID_PACKAGE}.`);
  }
  return withWingOscFiles(withWingOscRegistration(config));
};
