# 第三方组件

本项目独立实现了界面、聊天、记忆与上下文管理逻辑。产品思路参考了 SillyTavern 和 MaiBot 的角色与上下文管理方式。

- Windows 独立程序包含 Node.js 24.14.1，许可证及其第三方声明见 [node-LICENSE.txt](desktop/licenses/node-LICENSE.txt)，也可运行 `此间.exe --licenses` 查看。
- Android 运行适配使用 `buffer`（MIT）及其依赖 `base64-js`（MIT）、`ieee754`（BSD-3-Clause）。对应版权声明由打包器保留在 JavaScript 资源中。
- esbuild、postject、resedit 及 Android SDK/JDK 为构建工具；依赖版本记录在各目录的 package-lock.json 中。

MIT 许可证适用于本项目原创代码，第三方组件保留各自的许可证。
