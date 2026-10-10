import { createLarkBot } from '#/server/channels/lark'

// 飞书机器人：WebSocket 长连接，无需公网回调地址
const bot = createLarkBot()
await bot.initialize()
console.log('文财飞书机器人已启动')
