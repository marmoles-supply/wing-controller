import * as FileSystem from 'expo-file-system/legacy';

const writeQueues = new Map<string, Promise<void>>();

const backupUriFor = (uri: string) => `${uri}.bak`;
const nextUriFor = (uri: string) => `${uri}.next`;
const stagedBackupUriFor = (uri: string) => `${uri}.bak.next`;

const deleteIfPresent = async (uri: string) => {
  await FileSystem.deleteAsync(uri, { idempotent: true });
};

export const safeWriteJson = async (uri: string, value: unknown): Promise<void> => {
  const serialized = JSON.stringify(value, null, 2);
  JSON.parse(serialized);

  const previous = writeQueues.get(uri) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const nextUri = nextUriFor(uri);
      const backupUri = backupUriFor(uri);
      const stagedBackupUri = stagedBackupUriFor(uri);
      try {
        await deleteIfPresent(nextUri);
        await FileSystem.writeAsStringAsync(nextUri, serialized);
        JSON.parse(await FileSystem.readAsStringAsync(nextUri));

        const primaryInfo = await FileSystem.getInfoAsync(uri);
        if (primaryInfo.exists) {
          await deleteIfPresent(stagedBackupUri);
          await FileSystem.copyAsync({ from: uri, to: stagedBackupUri });
          JSON.parse(await FileSystem.readAsStringAsync(stagedBackupUri));
          await deleteIfPresent(uri);
        }
        await FileSystem.moveAsync({ from: nextUri, to: uri });

        const stagedBackupInfo = await FileSystem.getInfoAsync(stagedBackupUri);
        if (stagedBackupInfo.exists) {
          await deleteIfPresent(backupUri);
          await FileSystem.moveAsync({ from: stagedBackupUri, to: backupUri });
        }
      } catch (error) {
        const primaryInfo = await FileSystem.getInfoAsync(uri);
        const nextInfo = await FileSystem.getInfoAsync(nextUri);
        const stagedBackupInfo = await FileSystem.getInfoAsync(stagedBackupUri);
        const backupInfo = await FileSystem.getInfoAsync(backupUri);
        if (!primaryInfo.exists) {
          const recoveryUri = nextInfo.exists
            ? nextUri
            : stagedBackupInfo.exists
              ? stagedBackupUri
              : backupInfo.exists
                ? backupUri
                : null;
          if (recoveryUri) await FileSystem.copyAsync({ from: recoveryUri, to: uri });
        }
        throw error;
      } finally {
        const primaryInfo = await FileSystem.getInfoAsync(uri);
        if (primaryInfo.exists) {
          await deleteIfPresent(nextUri);
          await deleteIfPresent(stagedBackupUri);
        }
      }
    });

  writeQueues.set(uri, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(uri) === next) writeQueues.delete(uri);
  }
};

export const readJsonTextWithBackup = async (
  uri: string,
  validator?: (value: unknown) => boolean,
): Promise<string | null> => {
  const backupUri = backupUriFor(uri);
  const nextUri = nextUriFor(uri);
  const stagedBackupUri = stagedBackupUriFor(uri);
  const candidates = [uri, nextUri, stagedBackupUri, backupUri];
  let primaryError: unknown = null;

  for (const candidate of candidates) {
    const info = await FileSystem.getInfoAsync(candidate);
    if (!info.exists) continue;
    try {
      const content = await FileSystem.readAsStringAsync(candidate);
      const parsed = JSON.parse(content);
      if (validator && !validator(parsed)) {
        throw new Error(`Invalid JSON payload structure in ${candidate}`);
      }
      if (candidate !== uri) {
        await deleteIfPresent(uri);
        await FileSystem.copyAsync({ from: candidate, to: uri });
        console.warn(`[Safe JSON Storage] Recovered ${uri} from ${candidate}.`);
      }
      return content;
    } catch (error) {
      if (candidate === uri) primaryError = error;
    }
  }

  if (primaryError) throw primaryError;
  return null;
};
