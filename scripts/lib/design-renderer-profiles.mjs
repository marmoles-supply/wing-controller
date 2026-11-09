// Explicit, reviewed renderer records. No fallback to whichever image happens to pass.
export function selectRendererProfile(catalog, name, observed) {
  if (name === 'local') return { name, images: {} };
  if (!/^[a-z0-9-]+$/.test(name) || !catalog.profiles?.[name]) {
    throw new Error(`Unknown visual renderer profile: ${name}`);
  }
  const profile = catalog.profiles[name];
  const actual = { ...observed, osMajor: String(observed.osVersion).split('.')[0] };
  for (const key of ['platform', 'arch', 'osMajor', 'renderMode']) {
    if (profile.target[key] !== actual[key]) {
      throw new Error(`Visual profile ${name} requires ${key}=${profile.target[key]}, observed ${actual[key]}; capture and review a new reference explicitly`);
    }
  }
  const entries = Object.entries(profile.images || {});
  if (!entries.length || entries.some(([name, hash]) =>
    !/^[a-z]+-(light|dark)\.png$/.test(name) || !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error(`Invalid reviewed images for visual profile ${name}`);
  }
  return { ...profile, name };
}
