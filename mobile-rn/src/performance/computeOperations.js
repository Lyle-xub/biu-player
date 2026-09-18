// Bundled, pure code only. No React, network, storage or native module imports.
import library from '../../../renderer/library-sync';
import profile from '../../../renderer/recommendation-profile';
import daily from '../../../renderer/daily-recommendation';
import dailyMusic from '../../../renderer/daily-music-source';
import tokenizer from '../../../renderer/profile-tokenizer';
let vocabulary;
import md5 from 'js-md5';
import { Buffer } from 'buffer';
import { seal, unseal, hash } from '../cloud/envelope';

export function compute(operation, ...args) {
  const engine = operation.startsWith('discovery') ? profile.discovery : profile;
  if (operation.startsWith('discovery')) operation = 'profile' + operation.slice(9);
  switch (operation) {
    case 'profileTokenize':
      if(args[1]) vocabulary=JSON.parse(args[1]).model.vocab;
      if(!vocabulary) throw Error('分词器未加载');
      return tokenizer.encode(args[0],vocabulary);
    case 'parse': return JSON.parse(args[0]);
    case 'lanParse': return JSON.parse(Buffer.concat(args[0].map(part => Buffer.from(part, 'base64'))).toString('utf8'));
    case 'lanReply': {
      const bytes = Buffer.from(JSON.stringify(args[0]));
      const parts = [];
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        parts.push(bytes.toString('base64', offset, Math.min(offset + 64 * 1024, bytes.length)));
      }
      return { length: bytes.length, parts };
    }
    case 'stringify': return JSON.stringify(args[0]);
    case 'libraryNormalize': return library.normalize(...args);
    case 'libraryReconcile': return library.reconcile(...args);
    case 'libraryChanges': {
      const current = args[2];
      const next = library.reconcile(...args);
      const changes = {};
      for (const key of ['likes', 'library', 'playlists']) {
        const raw = JSON.stringify(next[key]);
        if (raw !== JSON.stringify(current[key] || [])) changes[key] = { value: next[key], raw };
      }
      return changes;
    }
    case 'librarySnapshot': {
      const value = library.normalize(...args);
      return { library: value, revision: md5(JSON.stringify(value)) };
    }
    case 'libraryFingerprint': return hash(JSON.stringify(library.normalize(...args)));
    case 'libraryPreview': return JSON.stringify(library.normalize(...args), null, 2).slice(0, 32000);
    case 'profileEvidence': return engine.recordEvidence(...args);
    case 'profileBuildPrepare': return engine.prepareBuild(...args);
    case 'profileBuildFinish': return engine.finishBuild(...args);
    case 'profileNormalize': return engine.normalize(args[0], args[1]);
    case 'profileReconcile': {
      const current = engine.normalize(args[2], false);
      const next = engine.reconcile(args[0], args[1], current);
      return JSON.stringify(next) === JSON.stringify(current) ? null : next;
    }
    case 'profileObserve': return { ...args[0], daily: daily.observe(args[0].daily, args[1]) };
    case 'profileListening': return { ...args[0], daily: daily.feedback(args[0].daily, args[1]) };
    case 'dailyNormalize': return daily.normalize(args[0]);
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
