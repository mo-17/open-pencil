---
layout: page
landing: true
sidebar: false
aside: false
title: 下载 OpenPencil 官方版
description: 下载官方上游 OpenPencil 桌面应用；低代码等本分支扩展请使用本分支源码构建。
---

<script setup>
import DownloadPage from '#docs/theme/landing/download/DownloadPage.vue'
import { zhCn } from '#docs/theme/landing/content/messages/zh-cn'
</script>

::: info 下载来源与本分支
本页安装包、Homebrew、在线应用和 npm CLI 均来自官方上游 `open-pencil/open-pencil`。本分支的低代码、Backend 和 Motion 扩展需要使用本分支源码构建；此处的官方安装包不代表本分支已发布安装包。请参阅[本分支源码构建说明](./getting-started#building-from-source)和[低代码应用指南](./user-guide/lowcode-apps)。
:::

<DownloadPage :messages="zhCn" />
