# Celeste Motion

https://github.com/user-attachments/assets/2f1263fa-84cd-46b4-9423-ee840503cd25

[下载 25 秒原画质演示](https://github.com/Charles-Tian077/codex-celeste-motion/releases/download/v1.0.0/Codex-Celeste-Demo-1440p.mp4) · [下载 Windows 部署包](https://github.com/Charles-Tian077/codex-celeste-motion/releases/download/v1.0.0/Celeste-Motion-Windows-x64.zip)

一套用于 Windows 桌面客户端的开场动画和循环背景。开场以 1 倍速播放 10.77 秒，从金色线稿播到烟花和人物向右偏头。进入主界面后，人物会继续眨眼、左右扫视，发辫、饰件和衣服随风摆动。两段素材均为 2560 × 1440、30 fps。

## 开始之前

1. 从 [Releases](https://github.com/Charles-Tian077/codex-celeste-motion/releases/latest) 下载 `Celeste-Motion-Windows-x64.zip` 并完整解压。发布包内有动画、启动程序和各端安装入口。
2. 安装要使用的 Windows 客户端。每次只需运行相应的安装脚本。
3. 首次部署可通过 `SHA256SUMS.txt` 校验 ZIP。安装脚本也会验证开场、循环和静帧的 SHA-256。

## Codex 桌面版

1. 安装并打开一次官方 Windows Codex。实测 Microsoft Store 版 `26.1120.5083.0`。
2. 双击 `Install-Desktop.cmd`，桌面会生成 **Codex Motion** 快捷方式。已经通过旧版部署生成 `Codex.lnk` 的电脑会复用旧入口。
3. 双击桌面动效入口。开场结束后进入原来的 Codex，主页、资料空间、侧栏和设置使用同一个动图背景。重复点击会激活同一个动效窗口。

任务栏的官方 Codex 入口用于普通窗口。动效版使用单独的 Windows 窗口分组。 [官方下载](https://openai.com/codex/)

## Codex for VS Code

1. 安装并启用官方 **Codex** 扩展，扩展 ID 为 `openai.chatgpt`。这个发布包针对 Windows 版 `26.1106.51428`。
2. 双击 `Install-VSCode.cmd`。重新打开 VS Code，或在命令面板运行 **Developer: Reload Window**。
3. 通过左侧活动栏打开 Codex 面板。窄侧栏会完整显示开场画幅，开场结束后进入循环背景。

安装器会保存当前扩展原版模板。双击 `Restore-VSCode.cmd` 并重新加载窗口可恢复。扩展升级后，先查看仓库的兼容版本，再运行对应安装器。 [官方扩展](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt)

VS Code 的扩展位于自定义目录时，可在 PowerShell 指定它。

```powershell
.\Install.ps1 -Target VSCode -ExtensionPath 'D:\VSCodeExtensions\openai.chatgpt-26.1106.51428-win32-x64'
```

## DeepSeek Harness 桌面版

DeepSeek、Qwen 和豆包章节提供本地客户端部署流程及对应启动器。适配效果以所用客户端版本为准。三种适配使用 Node.js 22 或更新版本，已装官方 Codex 时也可复用其内置运行时。 [Node.js 下载](https://nodejs.org/en/download)

1. 从 DeepSeek 官网下载并安装 **DeepSeek Harness for Windows**。
2. 完全退出正在运行的 DeepSeek Harness，然后双击 `Install-DeepSeek.cmd`。
3. 从桌面打开 **DeepSeek Motion**。首次进入时按客户端的提示登录或选择本地项目。

动效启动器针对 DeepSeek Harness 的 Electron 本地工作台 `dsh-app://app/`。客户端退出后可通过官方入口恢复普通启动。 [DeepSeek 官方下载](https://www.deepseek.com/en/download/)

## Qwen Code Desktop

1. 安装官方 **Qwen Code Desktop** Windows x64 版，系统需要 Microsoft Edge WebView2 Runtime。
2. 完全退出 Qwen Code Desktop，然后双击 `Install-Qwen.cmd`。
3. 从桌面打开 **Qwen Motion**。已有工作区和认证设置按 Qwen Code 自己的流程管理。

启动器使用 Qwen Code 本地窗口的 WebView2 渲染器。 [Qwen Code 下载](https://github.com/QwenLM/qwen-code/releases/tag/desktop-latest) · [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

## 豆包桌面版

1. 安装 **豆包 Windows 桌面版**。适配以客户端 `2.20.9` 的本地入口为参考。
2. 在系统托盘退出正在运行的豆包，然后双击 `Install-Doubao.cmd`。
3. 从桌面打开 **Doubao Motion**。启动器针对豆包本地程序的 `doubao://doubao-chat/chat` 窗口。

来自软件管家的安装同样可用。若安装器找不到程序，可指定豆包安装根目录下的 `Doubao.exe` 或 `app\Doubao.exe`。 [豆包官方下载](https://www.doubao.com/download/desktop)

## 自定义客户端位置

如果安装器找不到本地程序，可在已解压的目录中打开 PowerShell，传入目标客户端实际的 `.exe` 路径。三个安装器分别生成对应的桌面快捷方式。

```powershell
.\Install.ps1 -Target DeepSeek -Application 'D:\Apps\DeepSeek Harness\DeepSeek Harness.exe'
.\Install.ps1 -Target Qwen -Application 'D:\Apps\Qwen Code Desktop\Qwen Code Desktop.exe'
.\Install.ps1 -Target Doubao -Application 'D:\Apps\Doubao\app\Doubao.exe'
```

## 播放和恢复

- 动效入口使用 Windows 上已安装的客户端。各客户端自行管理模型、登录和本地项目。
- 开场和背景依次使用一个视频解码器。切离动效窗口或隐藏 VS Code 面板时会暂停并释放背景解码，返回时续播。
- 桌面适配在各自应用进程的本机回环端口连接渲染器。安装脚本只更新用户目录中的动效素材、快捷方式和已验证的 Codex 扩展模板。
- 想回到普通桌面界面时，用对应官方入口打开。卸载 VS Code 动效可运行 `Restore-VSCode.cmd`。

## 素材署名

分镜、动作设计和原始剪辑为 **Celeste_云中纤 / wynneceles**，画面由 Seedance 生成。本项目复用已获授权的改编素材，加入 Codex 等客户端的接入和眼动。第三方的再发布请按原作者素材许可和实际授权处理。 [作者项目](https://github.com/wynneceles/ai-boot-animations) · [作者许可](https://creativecommons.org/licenses/by-nc-nd/4.0/deed.zh-hans)

演示使用实际 Codex 界面与同一套播放素材合成，已处理账号、项目与对话标识。README 播放器使用便于加载的 720p 版本，发布页提供 1440p 同版视频。客户端应用及商标归各自权利人。
