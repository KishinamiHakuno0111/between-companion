# 此间 Android 独立版

安装包：[between-0.3.0-android.apk](https://github.com/KishinamiHakuno0111/between-companion/releases/download/v0.3.0/between-0.3.0-android.apk)。支持 Android 10 及以上，需要较新的 Android System WebView / Chrome。Java 字节码应用，不限制 ARM64、ARM 或 x86 架构。

## 安装使用

1. 将 APK 发到手机，在手机上打开并按系统提示安装。
   已安装旧版时直接覆盖安装，保留应用数据，不要先卸载。本版为 0.3.0（versionCode 3），沿用原签名。
2. 打开「此间」，进入 API 设置，选择 DeepSeek 官方或 OpenAI 兼容接口。
3. 填入自己的 Key，点击「连接」，选择模型并保存。DeepSeek 图片和文档使用 `deepseek-flash`。
4. 创建角色即可聊天。无需启动电脑、Node.js 或局域网服务。

应用界面、角色、聊天、记忆和原件存放在手机应用私有目录。手机直接请求配置的 API 服务商，因此聊天需要联网。APK 不包含开发时的 Key 或桌面数据库；手机和电脑的记录独立，目前不自动同步。请保留应用数据：卸载或清除数据会删除手机上的记录。

附件可使用系统文件选择器添加；输入法若支持图片粘贴，可直接粘贴，也可以点击输入框旁「贴」读取剪贴板图片。由于 Android/输入法对剪贴板图片的支持不同，无法读取时可通过附件按钮选择。已发送附件可点击并保存到手机选择的位置。手机版单个附件上限为 20 MiB。

返回键优先关闭弹窗、详情，再返回会话列表；列表页返回会将应用放到后台。长时间切后台可能被系统终止，未完成的消息可以重新打开应用后重试。

## 实现

- 界面与业务逻辑来自现有 `public/`、`server.js`、`core.js`、`provider.js` 和 `attachments.js`，由 esbuild 打包为本地资源。
- `runtime/platform.js` 把现有数据库调用映射到 Android SQLite，把本地 API 调用直接交给应用内处理函数，不启动 HTTP 服务器。
- `runtime/network.js` 与 Java 桥接完成 HTTPS/HTTP 请求、multipart 文件上传、SSE 数据传输和取消。
- `MainActivity.java` 负责私有数据库、离线资源、文件选择/保存、图片粘贴、麦克风授权与返回键。声明联网和录音权限，只有点击语音输入后才请求麦克风授权；文件访问通过系统选择器按次授权。关闭 Android 应用备份，不向第三方托管服务同步数据。
- 针对 Android 10 SQLite 版本，公共存储逻辑使用 `INSERT OR IGNORE` + `UPDATE`，避免新版 UPSERT 语法，也避免 `REPLACE` 级联删除历史。

## 构建

需要 JDK（本次使用 JDK 25）、Node.js 24、Python 3，以及 Google 官方 Android SDK Platform 36 / Build Tools 36.0.0。

```powershell
cd android
npm ci
python download-sdk.py
./build.ps1
```

SDK 下载位于 `tools/`，下载脚本校验 Google 仓库提供的校验和。`build.ps1` 会编译 Java、生成 DEX、打包并签名，在 `../dist/` 生成 APK 和 SHA-256 文件。

`signing/` 保存本机生成的签名密钥和密码文件，已排除版本管理。请单独保管；后续升级必须使用同一签名和更高 `versionCode` 才能直接覆盖安装并保留数据。不要把签名目录或包含私人聊天的数据库发给他人。此包为本地分发版，未发布应用商店。

## 验证范围

```powershell
npm test
cd ..
npm test
```

桌面 24 项测试通过。Android 运行适配层测试通过，覆盖 SQLite 桥、模型获取、角色隔离、附件读写、流式回复、当前时间、工具偏好和重新创建运行环境后的持久化。APK 已通过 Android `apksigner verify` 与包结构校验。输入框上方可设置联网搜索、深度思考、阅读链接与语音；详情见 [功能说明](../docs/FEATURES.md)。

当前环境没有连接 Android 真机；尚未完成真机安装、系统文件选择器及不同输入法上的端到端验证。

0.3.0 修复发送、回复完成和记忆通知时重建整个聊天列表的问题。流式气泡直接保留为正式消息，取消消息列表淡入与流式平滑滚动；发送时保持输入框可编辑，结束后手机不强制聚焦。已在 390px 窄屏验证消息节点复用、阅读位置、停止重试和角色切换；真实手机键盘表现仍待真机验证。
