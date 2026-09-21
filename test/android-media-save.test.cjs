const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const cache = path.join(os.homedir(), '.gradle/caches/modules-2/files-2.1');
function jar(group, name, version) {
  const dir = path.join(cache, group, name, version);
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.jar')).map(f => path.join(dir, f))[0];
}
const compiler = jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.1.20');
test('native media saving recognizes Unicode MP4 filenames and chooses the video collection', { skip: !compiler }, () => {
  const source = fs.readFileSync(path.join(__dirname, '../mobile-rn/node_modules/expo-media-library/android/src/main/java/expo/modules/medialibrary/MediaLibraryUtils.kt'), 'utf8');
  const guess = source.slice(source.indexOf('  private fun getMimeTypeFromFileUrl'), source.indexOf('  fun getMimeType(contentResolver')).replace('private fun', 'fun');
  const route = source.slice(source.indexOf('  fun mimeTypeToExternalUri'), source.indexOf('  fun getRelativePathForAssetType'));
  const code = `
    data class Uri(val value: String) {
      val lastPathSegment: String? get() = java.net.URI(value).path?.substringAfterLast('/')
      companion object { fun parse(value: String) = Uri(value) }
    }
    object MediaStore {
      object Images { object Media { val EXTERNAL_CONTENT_URI = Uri("images") } }
      object Video { object Media { val EXTERNAL_CONTENT_URI = Uri("videos") } }
      object Audio { object Media { val EXTERNAL_CONTENT_URI = Uri("audio") } }
    }
    object MimeTypeMap {
      fun getSingleton() = this
      fun getMimeTypeFromExtension(extension: String): String? = mapOf("mp4" to "video/mp4", "jpg" to "image/jpeg", "mp3" to "audio/mpeg")[extension]
      // Android's URL helper deliberately rejects punctuation/non-ASCII basenames.
      fun getFileExtensionFromUrl(url: String): String? {
        val name = Uri.parse(url).lastPathSegment ?: return null
        return if (Regex("[a-zA-Z_0-9.()-]+").matches(name)) name.substringAfterLast('.') else null
      }
    }
    object Production {
      val EXTERNAL_CONTENT_URI = Uri("files")
      ${guess}
      ${route}
    }
    fun main() {
      for (uri in listOf(
        "file:///downloads/【杜杜】铜…铜治酱！_BV1_1_120_123.mp4",
        "file:///downloads/%E6%AD%8C%E6%9B%B2%20%23100%25%3F.MP4",
        "file:///downloads/clip.mp4"
      )) {
        check(Production.getMimeTypeFromFileUrl(uri) == "video/mp4")
        check(Production.mimeTypeToExternalUri(Production.getMimeTypeFromFileUrl(uri)).value == "videos")
      }
      check(Production.getMimeTypeFromFileUrl("file:///downloads/封面.jpg") == "image/jpeg")
      check(Production.getMimeTypeFromFileUrl("file:///downloads/歌曲.mp3") == "audio/mpeg")
      println("Unicode media save checks passed")
    }
  `;
  const stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.1.20');
  const cp = [compiler, stdlib, jar('org.jetbrains.kotlin','kotlin-script-runtime','2.1.20'), jar('org.jetbrains.kotlin','kotlin-reflect','1.6.10'), jar('org.jetbrains.intellij.deps','trove4j','1.0.20200330'), jar('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm','1.8.0'), jar('org.jetbrains','annotations','13.0')].filter(Boolean).join(path.delimiter);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-mime-'));
  try {
    const file = path.join(dir, 'Media.kt'), out = path.join(dir, 'checks.jar');
    fs.writeFileSync(file, code);
    execFileSync('java', ['-cp', cp, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-classpath', stdlib, '-d', out, file], { timeout: 60000, stdio: 'pipe' });
    assert.match(execFileSync('java', ['-cp', `${out}${path.delimiter}${stdlib}`, 'MediaKt'], { encoding: 'utf8' }), /checks passed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
