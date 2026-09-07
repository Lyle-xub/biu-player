// Bundled, pure code only. No React, network, storage or native module imports.
import library from '../../../renderer/library-sync';
import profile from '../../../renderer/recommendation-profile';
import daily from '../../../renderer/daily-recommendation';
import dailyMusic from '../../../renderer/daily-music-source';
import md5 from 'js-md5';
import { Buffer } from 'buffer';
import { seal, unseal, hash } from '../cloud/envelope';

export function compute(operation, ...args) {
  switch (operation) {
    case 'parse': return JSON.parse(args[0]);
    case 'stringify': return JSON.stringify(args[0]);
    case 'libraryNormalize': return library.normalize(...args);
    case 'libraryReconcile': return library.reconcile(...args);
    case 'librarySnapshot': {
      const value = library.normalize(...args);
      return { library: value, revision: md5(JSON.stringify(value)) };
    }
    case 'libraryFingerprint': return hash(JSON.stringify(library.normalize(...args)));
    case 'libraryPreview': return JSON.stringify(library.normalize(...args), null, 2).slice(0, 32000);
    case 'profileNormalize': return profile.normalize(args[0]);
    case 'profileReconcile': {
      const current = profile.normalize(args[2]);
      const next = profile.reconcile(args[0], args[1], current);
      return JSON.stringify(next) === JSON.stringify(current) ? null : next;
    }
    case 'profileObserve': return { ...args[0], daily: daily.observe(args[0].daily, args[1]) };
    case 'profileListening': return { ...args[0], daily: daily.feedback(args[0].daily, args[1]) };
    case 'dailyTaste': return daily.taste(...args);
    case 'dailySelectSongs': return daily.selectSongs(...args);
    case 'dailySourceDecode': return dailyMusic.decode(...args);
    case 'dailySelect': return daily.select(...args);
    case 'seal': {
      const result = seal(args[0], Buffer.from(args[1], 'hex'), Buffer.from(args[2], 'hex'), args[3], args[4]);
      return { payload: result.payload.toString('base64'), snapshotId: result.snapshotId };
    }
    case 'unseal': return unseal(Buffer.from(args[0], 'base64'), Buffer.from(args[1], 'hex'), args[2]);
    default: throw Error('Unknown background operation: ' + operation);
  }
}
