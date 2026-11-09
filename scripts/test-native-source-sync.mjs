import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

// A source checkout has no generated android/ directory. Exercise the real Expo
// v55 config plugin against an isolated fixture instead of reading local build
// output. This checks generation and registration, not Kotlin compilation.
const require = createRequire(import.meta.url);
const withWingOsc = require('../plugins/with-wing-osc.js');

const canonicalModuleUrl = new URL('../native/wing-osc/android/WingOscModule.kt', import.meta.url);
const canonicalPackageUrl = new URL('../native/wing-osc/android/WingOscPackage.kt', import.meta.url);
const [canonicalModule, canonicalPackage, appConfigText] = await Promise.all([
  readFile(canonicalModuleUrl, 'utf8'),
  readFile(canonicalPackageUrl, 'utf8'),
  readFile(new URL('../app.json', import.meta.url), 'utf8'),
]);
const appConfig = JSON.parse(appConfigText).expo;
assert.match(appConfigText, /\.\/plugins\/with-wing-osc/, 'Expo config must install the WING native module plugin');
assert.match(canonicalModule, /ArrayBlockingQueue\(128\)/, 'native UDP work queue must remain bounded');
assert.match(canonicalModule, /requestId/, 'native TCP events must retain connection generation identity');

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'wing-native-plugin-'));
try {
  const source = path.join(fixtureRoot, 'native/wing-osc/android');
  const platformRoot = path.join(fixtureRoot, 'android');
  await mkdir(source, { recursive: true });
  await Promise.all([
    copyFile(fileURLToPath(canonicalModuleUrl), path.join(source, 'WingOscModule.kt')),
    copyFile(fileURLToPath(canonicalPackageUrl), path.join(source, 'WingOscPackage.kt')),
  ]);
  const config = withWingOsc({ ...appConfig });
  const request = { platform: 'android', projectRoot: fixtureRoot, platformProjectRoot: platformRoot, introspect: false };
  await config.mods.android.dangerous({ ...config, modResults: null, modRequest: { ...request, modName: 'dangerous' } });
  const destination = path.join(platformRoot, 'app/src/main/java', ...appConfig.android.package.split('.'));
  assert.equal(await readFile(path.join(destination, 'WingOscModule.kt'), 'utf8'), canonicalModule);
  assert.equal(await readFile(path.join(destination, 'WingOscPackage.kt'), 'utf8'), canonicalPackage);
  const fixture = 'class MainApplication {\n  val packages = PackageList(this).packages.apply {\n    // manual packages\n  }\n}\n';
  const register = (contents, language = 'kt') => config.mods.android.mainApplication({
    ...config, modResults: { contents, language }, modRequest: { ...request, modName: 'mainApplication' },
  });
  const registered = (await register(fixture)).modResults.contents;
  assert.equal((registered.match(/add\(WingOscPackage\(\)\)/g) || []).length, 1, 'MainApplication must register the native package once');
  assert.equal((await register(registered)).modResults.contents, registered, 'Repeated plugin execution must be idempotent');
  await assert.rejects(() => register(fixture, 'java'), /Kotlin MainApplication/);
  await assert.rejects(() => register('class MainApplication {}'), /anchor|match|merge|insert/i);
  assert.throws(() => withWingOsc({ ...appConfig, android: { package: 'example.unexpected' } }), /expects Android package/);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
console.log('Native source plugin generation and registration contracts passed (temporary fixture; no Android build).');
