import { launchImageLibraryAsync } from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

// Embed a small, square image so covers survive cache cleanup and device sync.
export async function pickPlaylistCover() {
  const result = await launchImageLibraryAsync({
    mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri || !(asset.width > 0 && asset.height > 0)) throw new Error('无法读取这张图片，请换一张试试');
  const context = ImageManipulator.manipulate(asset.uri);
  let image, saved;
  try {
    const size = Math.min(asset.width, asset.height);
    context.crop({ originX: Math.floor((asset.width - size) / 2), originY: Math.floor((asset.height - size) / 2), width: size, height: size });
    context.resize({ width: Math.min(size, 512), height: Math.min(size, 512) });
    image = await context.renderAsync();
    saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
    if (!saved.base64) throw new Error('封面处理失败，请重试');
    return `data:image/jpeg;base64,${saved.base64}`;
  } finally {
    image?.release();
    context.release();
    // Only delete our resized output, never the user's selected original.
    if (saved?.uri && saved.uri !== asset.uri) {
      try { new File(saved.uri).delete(); } catch (_) { /* Cache cleanup is best effort. */ }
    }
  }
}
