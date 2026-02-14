# Bilibilibot

Bilibilibot 是一个基于Websocket协议与Napcat建立通信的机器人app，用于在群聊中分析B站小程序卡/b23.tv/视频直链并提取相关信息。
使用AI编写。

## 使用方法

### 1. 克隆并安装

```bash
git clone https://github.com/ll3me/bilibilibot.git
cd bilibilibot
pnpm install
```

### 2. 编辑配置

将 `config.json.example` 改名为 `config.json`，根据需求修改：

```json
{
  "enabled": true, // 是否启用全局解析功能
  "enabledPrivateMsg": true, // 是否响应私聊解析
  "sendAsForward": true, // 是否以合并转发形式发送，避免刷屏
  "napcat": {
    "url": "ws://localhost:3000/ws", // Napcat WebSocket 地址
    "accessToken": "" // 访问密钥
  },
  "petPhrase": "喵(=^‥^=)", // 机器人口癖
  "enabledGroups": ["123456789"], // 启用的群号列表
  "owner": "987654321", // 机器人主人 QQ
  "commandPrefix": "/bilibilibot" // 指令前缀
}
```

### 3. 启动项目

```bash
pnpm start
```

### 4. 机器人指令

机器人默认仅处理 **私聊** 中的管理指令。请确保 `owner` 已设置为你的 QQ 号。
在私聊中发送以下指令查看帮助：
`/bilibilibot help`

## 项目结构

- `index.ts`: 程序入口，负责启动 WebSocket 监听。
- `lib.ts`: 核心逻辑库，包含链接解析、API 请求、消息处理等。
- `config.json.example`: 配置模板文件。
- `vitest.config.ts`: 测试配置文件。
- `lib.test.ts`: 单元测试文件，AI写的。
