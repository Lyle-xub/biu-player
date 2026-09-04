# 开发与构建

用户介绍和下载入口见 [README](../README.md)。

## 桌面端

```bash
npm install
npm start
npm run check
```

发布包默认使用 `web/` 的 React 界面，通过 `npm run build:web` 构建，`npm run start:web` 预览。
源码尚未构建时回退到 `renderer/` 界面；`BIU_WEB_UI=0 npm start` 可显式使用旧界面。
Electron 的主进程与桥接入口为 `main.js`、`preload.js`。

macOS 打包使用 electron-builder，自动查找本机可用的签名证书；请在本机配置签名，不要将证书身份写入仓库。

```bash
npm run dist -- --arm64
```

Windows x64 安装包与免安装 ZIP 在 Windows 上构建。安装 Node.js 24 和 Visual Studio C++ Build Tools 后运行：

```powershell
npm ci
npm run dist:win -- --publish never
```

构建命令会先编译 React 页面与视频云同步 DLL，再生成 NSIS 安装包和 ZIP。输出位于 `dist/`；Windows 安装包目前未配置代码签名。
也可以在 GitHub Actions 手动运行 `Windows release`，填写已有 Release 标签；流程会在 Windows 上检查 DLL、启动应用，再上传这两种安装文件与校验值。

## 手机端

使用 React Native / Expo SDK 57，建议 Node.js 22.13+、JDK 17 和 Android SDK。

```bash
cd mobile-rn
npm install
npx expo prebuild --platform android
npx expo run:android
```

日常开发使用 `npm start` 连接开发客户端。局域网自动发现、视频云同步需要原生模块，不能只用 Expo Go 验证。
独立 APK 使用 `android/gradlew :app:assembleRelease` 构建。当前沿用项目已有签名以兼容此前安装包；分发自己的正式版本时应配置自己的签名。

分切 WebView 在 Metro 启动时由 `scripts/build-split.cjs` 从桌面代码和本地 WASM 生成。
修改分切源码后可手动运行该脚本，或重新启动 Metro。

## 数据与同步

- `renderer/library-sync.js`：双端音乐库的合并格式。
- `renderer/recommendation-profile.js`、`renderer/daily-recommendation.js`：画像与每日推荐。
- `lan-sync.js`、`mobile-rn/src/store/lanSync.js`：局域网发现、连接与同步。

桌面视频云同步需要 Python 3.12+ 和 FFmpeg。Windows 发布包附带 Wirehair DLL；macOS / Linux 首次使用还需要 C++ 编译器。首次启用会在应用数据目录创建独立 Python 环境。手机端使用原生模块，无需 Python 或 FFmpeg。

在设置中创建视频云同步后，通过恢复密钥配对其他设备；同账号的局域网自动同步也能交换密钥。恢复密钥和登录信息只保存在设备上，不要提交到仓库。

构建目录、登录数据、恢复密钥和签名文件不应提交到仓库。
