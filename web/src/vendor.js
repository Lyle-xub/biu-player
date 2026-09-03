/* 共享模块装载：把旧版经典脚本挂到 window，供 ES 模块化的 controller 解析全局标识符。
 * - renderer/api.js：末尾已追加 window.api / window.coverSVG
 * - renderer/playback-session.js：UMD 在 Vite 下会走 CJS 分支（module.exports = factory()），
 *   故显式 import 工厂结果再挂 window
 * - renderer/split-decode.js：IIFE，自行挂 window.splitDecodeAacStream
 * - Hls：由 web/index.html 的 <script src="./vendor/hls.min.js"> 经典脚本提供
 */
import '../../renderer/api.js';
import '../../renderer/hot-comment-motion.js';
import '../../renderer/player-sheet-motion.js';
import BiuPlaybackSession from '../../renderer/playback-session.js';
import BiuLibrarySync from '../../renderer/library-sync.js';
import '../../renderer/split-decode.js';

window.BiuPlaybackSession = BiuPlaybackSession;
window.BiuLibrarySync = BiuLibrarySync;

export const api = window.api;
export const coverSVG = window.coverSVG;
