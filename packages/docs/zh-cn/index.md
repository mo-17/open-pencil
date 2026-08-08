---
layout: home
title: OpenPencil — 开源设计编辑器
description: 开源的 Figma 替代方案。可打开 .fig 文件，内置 AI，并且完全可编程。

hero:
  name: OpenPencil
  text: 开源设计编辑器
  tagline: 打开 Figma 文件，使用内置 AI，并通过编程自由扩展。它也是构建自定义编辑器的工具包。
  actions:
    - theme: brand
      text: 在线体验
      link: https://app.openpencil.dev/demo
    - theme: alt
      text: 下载
      link: https://github.com/open-pencil/open-pencil/releases/latest
    - theme: alt
      text: GitHub
      link: https://github.com/open-pencil/open-pencil

features:
  - icon: 📂
    title: 兼容 Figma
    details: 原生打开 .fig 文件，可在 Figma 与 OpenPencil 之间复制粘贴。采用 Kiwi 二进制编解码器，确保往返转换的保真度。
  - icon: ⚡
    title: 可编程
    details: 使用无头 CLI 检查、导出和分析 .fig 文件；通过 eval 调用 Figma Plugin API；支持 Tailwind CSS 导出，并为 CI 和自动化提供 JSON 输出。
  - icon: 🚀
    title: 低代码应用
    details: 将页面编译为 React/Tailwind 应用，支持状态、绑定、Supabase 操作、工作流、国际化、shadcn/ui 输出，以及预览、构建和部署。
  - icon: 🧩
    title: 不只是应用，更是工具包
    details: 使用 Vue SDK 构建自定义编辑界面，将 OpenPencil 嵌入其他产品，或基于同一套核心组装面向特定工作流的编辑器。
  - icon: 🤖
    title: AI 原生
    details: 内置聊天助手，精选 50 多种工具；MCP 服务器提供 140 多种设计操作，可供 Claude Code、Cursor 和 Windsurf 使用。
  - icon: 📖
    title: 开源
    details: 采用 MIT 许可证。编辑器、引擎、文件编解码器和 CLI 的全部代码都可阅读和修改。
  - icon: 🖥️
    title: 免费且本地优先
    details: 无需账号、服务器或网络连接。可通过 Homebrew 安装约 7 MB 的桌面应用，也可直接使用 Web 应用。
  - icon: 👥
    title: 实时协作
    details: 通过 WebRTC 进行点对点协作，无需服务器。分享链接即可共同编辑，并支持实时光标和跟随模式。
---
