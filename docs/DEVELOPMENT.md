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

构建命令会先编译 React 页面，并下载、校验和准备完整的视频云同步组件，再生成安装包。输出位于 `dist/`；Windows 安装包目前未配置代码签名。
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

macOS（Apple Silicon）和 Windows（x64）安装包内置 Python、FFmpeg、证书及同步依赖，用户无需另外安装，也不会在首次使用时下载依赖。源码运行先执行 `npm run build:cloud`；构建机器需要联网和 C++ 编译器，Windows 需要 Visual Studio C++ Build Tools。依赖版本和下载校验值固定在构建脚本中，许可证随组件分发。手机端使用原生模块。

在设置中创建视频云同步后，通过恢复密钥配对其他设备；同账号的局域网自动同步也能交换密钥。恢复密钥和登录信息只保存在设备上，不要提交到仓库。

构建目录、登录数据、恢复密钥和签名文件不应提交到仓库。

## 应用更新

正式版默认自动检测更新，桌面端后台下载、退出后安装，也可点击重启安装。Android 在 Wi-Fi 下后台下载，安装前校验 SHA-256、包名、版本及签名，再交给系统确认安装。设置可关闭自动检测或自动下载。

桌面发布时，除了安装包，还必须上传 `latest.yml`（Windows）、`latest-mac.yml`（macOS）及对应 `.blockmap` 文件；使用构建生成的原始文件名，并在安装包上传完成后上传更新元数据。Windows 工作流已包含此步骤。不要重命名或修改已生成元数据所对应的安装包。

Android 更新从正式 GitHub Release 中读取 `Biu-Player-版本-android-arm64.apk`，以 APK 文件名中的版本独立比较，不使用桌面标签号。每次发布必须同时增加 `expo.version` 和 Android `versionCode`，并使用同一签名。iOS 通过 App Store 查询与跳转更新，尚未上架时不会提示不存在的更新。Expo Go / 开发客户端不执行安装更新。
