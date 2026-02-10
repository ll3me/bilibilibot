import axios from 'axios';
import { WebSocket } from 'ws';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configFile = path.join(__dirname, "config.json");

interface Config {
    enabled: boolean;
    enabledPrivateMsg: boolean;
    napcat: {
        url: string;
        accessToken: string;
    }
    petPhrase: string;
    enabledGroups: string[];
    owner: string;
    commandPrefix: string;
}

interface MessageSegment {
    type: string;
    data?: Record<string, any>;
}

interface NapcatEvent {
    post_type?: string;
    raw_message?: string;
    user_id: number;
    group_id?: number;
    message_type?: 'group' | 'private' | string;
    message?: MessageSegment[] | string;
}

interface SendMessagePayload {
    action: 'send_group_msg' | 'send_private_msg';
    params: {
        group_id?: number;
        user_id?: number;
        message: string;
    };
}

const DEFAULT_CONFIG: Config = {
    enabled: true,
    enabledPrivateMsg: true,
    napcat: {
        url: "ws://localhost:3000/ws",
        accessToken: "",
    },
    petPhrase: "",
    enabledGroups: [],
    owner: "",
    commandPrefix: "/bilibilibot",
};

const AXIOS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Connection: "keep-alive",
};


function formatNumber(num: number): string {
    if (num >= 1e8) return (num / 1e8).toFixed(2) + "亿";
    if (num >= 1e4) return (num / 1e4).toFixed(2) + "万";
    return num.toString();
}

export class BilibiliMessageScanner {
    static extractUrl(event: any): { url: string; source: 'miniprogram' | 'text_share'; needsParamRemoval: boolean } | null {
        if (Array.isArray(event.message)) {
            const jsonSegment = event.message.find((seg: any) => seg.type === 'json');
            if (jsonSegment && jsonSegment.data && jsonSegment.data.data) {
                try {
                    const jsonData = JSON.parse(jsonSegment.data.data);
                    if (jsonData.meta && jsonData.meta.detail_1 && jsonData.meta.detail_1.appid === "1109937557") {
                        const rawUrl = jsonData.meta.detail_1.qqdocurl;
                        if (rawUrl) {
                            return {
                                url: rawUrl,
                                source: 'miniprogram',
                                needsParamRemoval: true
                            };
                        }
                    }
                } catch (e) {
                }
            }
        }

        const rawMessage = event.raw_message || "";

        // 1. 尝试从文本中提取 b23.tv 短链接
        const b23Match = rawMessage.match(/(https?:\/\/b23\.tv\/[a-zA-Z0-9]+)/);
        if (b23Match) {
            return {
                url: b23Match[1],
                source: 'text_share',
                needsParamRemoval: false
            };
        }

        // 2. 尝试从文本中提取 bilibili.com 视频链接
        const bbMatch = rawMessage.match(/(https?:\/\/(www\.)?bilibili\.com\/video\/(BV[a-zA-Z0-9]+|av[0-9]+)[^\s]*)/);
        if (bbMatch) {
            return {
                url: bbMatch[1],
                source: 'text_share',
                needsParamRemoval: true
            };
        }

        return null;
    }
}

export class BvidParser {
    static removeUrlParams(url: string): string {
        try {
            const urlObj = new URL(url);
            return `${urlObj.origin}${urlObj.pathname}`;
        } catch (error) {
            return url.split("?")[0].split("#")[0];
        }
    }

    static async parse(b23Url: string): Promise<string | null> {
        try {
            // 0. 如果已经是包含 BV 号的长链接，直接提取，跳过网络请求
            const directMatch = b23Url.match(/\/video\/(BV[a-zA-Z0-9]+)/);
            if (directMatch && directMatch[1]) {
                const bvId = directMatch[1];
                console.log(`✅ 直接从链接提取 BV 号: ${bvId}`);
                return bvId;
            }

            console.log(`BV模式: 正在解析 ${b23Url}`);
            const response = await axios.get(b23Url, {
                headers: {
                    ...AXIOS_HEADERS,
                    Referer: "https://www.bilibili.com/",
                },
                timeout: 5000,
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400,
            });

            let finalUrl = response.headers.location || b23Url;
            if (finalUrl.startsWith("//")) finalUrl = "https:" + finalUrl;

            console.log(`🔗 最终解析地址: ${finalUrl}`);
            if (
                finalUrl.includes("/ss/") ||
                finalUrl.includes("/md/") ||
                finalUrl.includes("/bangumi/") ||
                finalUrl.includes("live.bilibili.com") ||
                finalUrl.includes("space.bilibili.com")
            ) {
                console.log(`🟡 识别为番剧/影视/直播链接，跳过`);
                return null;
            }

            const bvMatch = finalUrl.match(/\/video\/(BV[a-zA-Z0-9]+)/);

            if (bvMatch && bvMatch[1]) {
                const bvId = bvMatch[1];
                console.log(`✅ BV号提取成功: ${bvId}`);
                return bvId;
            } else {
                console.warn(`⚠️ 未能在最终URL中找到BV号: ${finalUrl}`);
                return null;
            }
        } catch (error: any) {
            console.error(`❌ 解析BV号时发生错误: ${error.message}`);
            return null;
        }
    }
}

export class BilibiliVideoParser {
    static getVideoZone(tid: number): string {
        const zones: { [key: number]: string } = {
            1: "动画", 24: "MAD·AMV", 25: "MMD·3D", 47: "短片·手书", 210: "手办·模玩", 86: "特摄", 27: "综合",
            13: "番剧", 33: "连载动画", 32: "完结动画", 51: "资讯", 152: "官方延伸",
            167: "国创", 153: "国产动画", 168: "国产原创相关", 169: "布袋戏", 170: "资讯", 195: "动态漫·广播剧",
            3: "音乐", 28: "原创音乐", 31: "翻唱", 30: "VOCALOID·电声", 194: "电音", 59: "演奏", 193: "MV", 29: "音乐现场", 130: "音乐综合", 243: "乐评盘点", 244: "VLOG",
            129: "舞蹈", 20: "宅舞", 154: "三次元舞蹈", 156: "舞蹈教程", 198: "原创舞蹈", 199: "新势力舞蹈", 200: "国风舞蹈", 255: "颜值·网红舞",
            4: "游戏", 17: "单机游戏", 171: "电子竞技", 172: "手机游戏", 65: "网络游戏", 173: "家用机", 121: "GMV", 136: "音游", 19: "Mugen",
            36: "知识", 201: "科学科普", 124: "社科·法律·心理", 207: "财经商业", 208: "校园学习", 209: "职业职场", 228: "人文历史", 229: "设计·创意", 122: "野生技术协会",
            188: "科技", 95: "数码", 230: "软件应用", 231: "计算机技术", 232: "工业·工程·机械", 233: "极客DIY",
            234: "运动", 235: "篮球", 249: "足球", 164: "健身", 236: "竞技体育", 237: "运动后花园", 238: "运动综合",
            223: "汽车", 176: "汽车生活", 224: "汽车选购", 225: "测评安利", 226: "汽车赛事", 227: "改装玩车",
            160: "生活", 138: "搞笑", 21: "日常", 76: "美食圈", 75: "动物圈", 161: "手工", 162: "绘画", 163: "运动", 174: "其他", 239: "家居房产", 240: "数码", 254: "亲子", 250: "出行", 251: "三农",
            211: "美食", 212: "美食侦探", 213: "美食测评", 214: "田园美食", 215: "美食记录",
            217: "动物圈", 218: "喵星人", 219: "汪星人", 220: "大熊猫", 221: "野生动物", 222: "爬宠/小宠",
            119: "鬼畜", 22: "鬼畜调教", 26: "音MAD", 126: "人力VOCALOID", 216: "鬼畜剧场", 127: "教程演示",
            155: "时尚", 157: "美妆护肤", 158: "穿搭", 159: "时尚潮流", 192: "风尚标", 252: "仿妆cos",
            202: "资讯", 203: "热点", 204: "环球", 205: "社会", 206: "综合",
            165: "广告", 166: "广告",
            5: "娱乐", 71: "综艺", 241: "娱乐杂谈", 242: "粉丝创作", 137: "明星动态",
            181: "影视", 182: "影视杂谈", 183: "影视剪辑", 85: "小剧场", 184: "预告·资讯",
            177: "纪录片", 37: "人文·历史", 178: "科学·探索·自然", 179: "军事", 180: "社会·美食·旅行",
            23: "电影", 147: "华语电影", 145: "欧美电影", 146: "日本电影", 83: "其他国家",
            11: "电视剧", 185: "国产剧", 187: "海外剧"
        };
        return zones[tid] || "未知分区";
    }
    static async getVideoInfo(bvId: string): Promise<Object | null> {
        try {
            const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`;
            const response = await axios.get(apiUrl, {
                headers: {
                    ...AXIOS_HEADERS,
                    Referer: "https://www.bilibili.com/",
                },
                timeout: 5000,
            });
            if (response.data && response.data.code === 0) {
                console.log(`✅ 视频信息获取成功: ${response.data.data.title}`);
                return response.data.data;
            } else {
                console.warn(`⚠️ 视频信息获取失败: ${response.data.message || "未知错误"}`);
                return null;
            }
        } catch (error: any) {
            console.error(`❌ 获取视频信息时发生错误: ${error.message}`);
            return null;
        }
    }
    static async processVideoInfo(videoInfo: any): Promise<string> {
        const title = videoInfo.title;
        const bvid = videoInfo.bvid;
        const pic = videoInfo.pic;
        const _tid = videoInfo.tid;
        const upName = videoInfo.owner.name;
        const view = videoInfo.stat.view;
        const danmaku = videoInfo.stat.danmaku;
        const reply = videoInfo.stat.reply;
        const favorite = videoInfo.stat.favorite;
        const coin = videoInfo.stat.coin;
        const share = videoInfo.stat.share;
        const like = videoInfo.stat.like;
        const zone = this.getVideoZone(_tid);

        return `[CQ:image,file=${pic}]\n` +
            `📺 ${title}\n` +
            `📑 BV号: ${bvid}\n` +
            `👤 UP主: ${upName}\n` +
            `🏷️ 分区: ${zone}\n` +
            `📈 播放: ${formatNumber(view)} | 💬 弹幕: ${formatNumber(danmaku)}\n` +
            `📝 评论: ${formatNumber(reply)} | ⭐ 收藏: ${formatNumber(favorite)}\n` +
            `🪙 投币: ${formatNumber(coin)} | 🔄 分享: ${formatNumber(share)} | 👍 点赞: ${formatNumber(like)}\n` +
            `🔗 链接: https://www.bilibili.com/video/${bvid}`;
    }
}

export class CommandHandler {

    static async setGlobalEnabled(enabled: boolean): Promise<void> {
        App.config = { ...App.config, enabled };
        await App.saveConfig();
    }

    static async setPrivateMsgEnabled(enabled: boolean): Promise<void> {
        App.config = { ...App.config, enabledPrivateMsg: enabled };
        await App.saveConfig();
    }

    static async addEnabledGroup(groupId: string): Promise<void> {
        if (!App.config.enabledGroups.includes(groupId)) {
            App.config.enabledGroups.push(groupId);
            await App.saveConfig();
        }
    }

    static async removeEnabledGroup(groupId: string): Promise<boolean> {
        const index = App.config.enabledGroups.findIndex(id => id === groupId);
        if (index !== -1) {
            App.config.enabledGroups.splice(index, 1);
            await App.saveConfig();
            return true;
        }
        return false;
    }

    static async handleCommand(command: string, args: string[], senderId: string, isGroup: boolean): Promise<[string | null, boolean]> {
        const adminCommands = ["enable", "disable", "add_group", "remove_group", "enable_private", "disable_private"];
        if (isGroup) {
            return ["❌ 该命令只能在私聊中使用", false];
        }
        // 权限检查
        if (adminCommands.includes(command)) {
            if (App.config.owner && senderId.toString() !== App.config.owner.toString()) {
                return ["❌ 你没有权限执行此命令", true];
            }
        }

        switch (command) {
            case "help":
                return [[
                    "📜 BilibiliBot 命令列表:",
                    `${App.config.commandPrefix} enable - 启用全局解析`,
                    `${App.config.commandPrefix} disable - 禁用全局解析`,
                    `${App.config.commandPrefix} enable_private - 启用私聊解析`,
                    `${App.config.commandPrefix} disable_private - 禁用私聊解析`,
                    `${App.config.commandPrefix} add_group <群号> - 添加群到白名单`,
                    `${App.config.commandPrefix} remove_group <群号> - 移出白名单`,
                    `${App.config.commandPrefix} help - 显示此帮助`
                ].join("\n"), true];
            case "enable":
                await CommandHandler.setGlobalEnabled(true);
                return [`✅ 已启用视频解析服务`, true];
            case "disable":
                await CommandHandler.setGlobalEnabled(false);
                return [`✅ 已禁用视频解析服务`, true];
            case "enable_private":
                await CommandHandler.setPrivateMsgEnabled(true);
                return [`✅ 已启用私聊消息解析`, true];
            case "disable_private":
                await CommandHandler.setPrivateMsgEnabled(false);
                return [`✅ 已禁用私聊消息解析`, true];
            case "add_group":
                if (args.length > 0) {
                    await CommandHandler.addEnabledGroup(args[0]);
                    return [`✅ 已添加群 ${args[0]} 到解析列表`, true];
                }
                return ["⚠️ 请提供群号", true];
            case "remove_group":
                if (args.length > 0) {
                    const success = await CommandHandler.removeEnabledGroup(args[0]);
                    if (success) {
                        return [`✅ 已从解析列表移除群 ${args[0]}`, true];
                    } else {
                        return [`⚠️ 群 ${args[0]} 不在解析列表中`, true];
                    }
                }
                return ["⚠️ 请提供群号", true];
            default:
                return ["⚠️ 未知的命令", true];
        }
    }
}

export class NapcatService {

    private static ws: WebSocket | null = null;

    private static async sendMessage(isGroup: boolean, targetId: number, message: string): Promise<void> {
        if (!NapcatService.ws || NapcatService.ws.readyState !== WebSocket.OPEN) return;
        const delayMs = 500 + Math.floor(Math.random() * 501);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        const payload: SendMessagePayload = {
            action: isGroup ? "send_group_msg" : "send_private_msg",
            params: {
                [isGroup ? "group_id" : "user_id"]: targetId,
                message: message
            }
        };
        NapcatService.ws.send(JSON.stringify(payload));
    }

    static async connectToNapcat(): Promise<void> {
        const url = App.config.napcat.url;
        const accessToken = App.config.napcat.accessToken;

        console.log(`🔌 正在连接到 NapCat: ${url}`);

        const headers: any = {
            "User-Agent": "BilibiliBot/1.0"
        };
        if (accessToken) {
            headers["Authorization"] = `Bearer ${accessToken}`;
        }

        NapcatService.ws = new WebSocket(url, [], {
            headers: headers
        });

        const ws = NapcatService.ws;

        ws.on('open', () => {
            console.log(`✅ 已连接到 NapCat`);
        });

        ws.on('message', async (data: WebSocket.RawData) => {
            try {
                const messageStr = data.toString();
                const event = JSON.parse(messageStr) as NapcatEvent;

                if (event.post_type !== 'message') return;

                const rawMessage = event.raw_message || "";
                const userId = event.user_id;
                const groupId = event.group_id;
                const messageType = event.message_type;
                const isGroup = messageType === 'group';
                const targetId = isGroup ? groupId : userId;

                if (isGroup && typeof groupId !== "number") return;
                if (!isGroup && typeof userId !== "number") return;

                if (rawMessage.startsWith(App.config.commandPrefix)) {
                    const parts = rawMessage.slice(App.config.commandPrefix.length).trim().split(/\s+/);
                    const command = parts[0];
                    const args = parts.slice(1);

                    const [replyMsg, shouldReply] = await CommandHandler.handleCommand(command, args, userId.toString(), isGroup);
                    if (shouldReply && replyMsg) {
                        await NapcatService.sendMessage(isGroup, targetId as number, replyMsg);
                    }
                    return;
                }

                if (!App.config.enabled) return;
                if (isGroup && !App.config.enabledGroups.includes((targetId as number).toString())) return;
                if (!isGroup && !App.config.enabledPrivateMsg) return;

                const extractResult = BilibiliMessageScanner.extractUrl(event);
                if (extractResult) {
                    const { url, source, needsParamRemoval } = extractResult;
                    const targetUrl = needsParamRemoval ? BvidParser.removeUrlParams(url) : url;

                    console.log(`[${isGroup ? `群:${groupId}` : `私聊:${userId}`}] 检测到B站${source}, 提取到链接: ${targetUrl}`);

                    const bvid = await BvidParser.parse(targetUrl);
                    if (bvid) {
                        const videoInfo = await BilibiliVideoParser.getVideoInfo(bvid);
                        if (videoInfo) {
                            let replyText = await BilibiliVideoParser.processVideoInfo(videoInfo);
                            if (App.config.petPhrase) {
                                replyText += `\n${App.config.petPhrase}`;
                            }

                            await NapcatService.sendMessage(isGroup, targetId as number, replyText);
                        }
                    }
                }

            } catch (error: any) {
                console.error(`❌ 处理消息时发生错误: ${error.message}`);
            }
        });

        ws.on('close', () => {
            console.log(`❌ 连接断开，5秒后重连...`);
            setTimeout(() => NapcatService.connectToNapcat(), 5000);
        });

        ws.on('error', (error: any) => {
            console.error(`❌ WebSocket 错误: ${error.message}`);
        });
    }
}

export class App {
    static config: Config;

    static async loadConfig(): Promise<Config> {
        try {
            if (!fs.existsSync(configFile)) {
                console.log(`🟡 配置文件不存在，正在创建默认配置...`);
                await fs.promises.writeFile(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
                return DEFAULT_CONFIG;
            }
            const configData = await fs.promises.readFile(configFile, "utf-8");
            const loadedConfig = JSON.parse(configData);
            console.log(`✅ 配置文件加载成功: ${configFile}`);
            // 合并默认配置，确保未写的项也能有默认值
            return { ...DEFAULT_CONFIG, ...loadedConfig };
        } catch (error: any) {
            console.error(`❌ 加载配置文件失败，将使用默认配置: ${error.message}`);
            return DEFAULT_CONFIG;
        }
    }

    static async saveConfig(): Promise<void> {
        try {
            await fs.promises.writeFile(configFile, JSON.stringify(App.config, null, 2), "utf-8");
            console.log(`✅ 配置文件保存成功: ${configFile}`);
        } catch (error: any) {
            console.error(`❌ 保存配置文件失败: ${error.message}`);
        }
    }

    static async run(): Promise<void> {
        App.config = await App.loadConfig();
        await NapcatService.connectToNapcat();
    }
}