import md5 from 'js-md5';
import { File } from 'expo-file-system';
import { writeAsStringAsync } from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { native, fs, path, directory } from '../cloud/platform';
import { createLargeStorage } from './largeStorageCore';

const folder = path.join(path.dirname(directory), 'library-values');
const file = key => path.join(folder, md5(key) + '.json');
export default createLargeStorage({
  legacy: AsyncStorage,
  readLegacyLarge: native?.readLegacyStorage ? key => native.readLegacyStorage(key) : undefined,
  files: native ? {
    exists: key => fs.existsSync(file(key)),
    read: key => fs.existsSync(file(key)) ? new File(file(key)).text() : null,
    write: async (key, value) => {
      fs.mkdirSync(folder);
      const target = file(key), temporary = target + '.tmp';
      // String-only async native I/O: large sync snapshots must not block tab presses.
      try { await writeAsStringAsync(temporary, value); fs.renameSync(temporary, target); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    },
    remove: key => { if (fs.existsSync(file(key))) fs.unlinkSync(file(key)); },
  } : null,
});
