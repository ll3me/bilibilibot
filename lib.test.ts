import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BvidParser, BilibiliVideoParser, CommandHandler, App, BilibiliMessageScanner, NapcatService } from './lib.ts';
import axios from 'axios';
import fs from 'fs';

vi.mock('axios');
vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(),
        promises: {
            writeFile: vi.fn(),
            readFile: vi.fn()
        }
    },
    existsSync: vi.fn(),
    promises: {
        writeFile: vi.fn(),
        readFile: vi.fn()
    }
}));

describe('BilibiliMessageScanner', () => {
    it('should extract URL from JSON message (mini-program)', () => {
        const event = {
            message: [{
                type: 'json',
                data: {
                    data: JSON.stringify({
                        meta: {
                            detail_1: {
                                appid: "1109937557",
                                qqdocurl: "https://www.bilibili.com/video/BV1xyz"
                            }
                        }
                    })
                }
            }]
        };
        const result = BilibiliMessageScanner.extractUrl(event);
        expect(result).toEqual({
            url: "https://www.bilibili.com/video/BV1xyz",
            source: 'miniprogram',
            needsParamRemoval: true
        });
    });

    it('should extract b23.tv short link from text', () => {
        const event = { raw_message: "看看这个 https://b23.tv/abcd 很有趣" };
        const result = BilibiliMessageScanner.extractUrl(event);
        expect(result).toEqual({
            url: "https://b23.tv/abcd",
            source: 'text_share',
            needsParamRemoval: false
        });
    });

    it('should extract bilibili.com video link from text', () => {
        const event = { raw_message: "https://www.bilibili.com/video/BV123/?spm=1" };
        const result = BilibiliMessageScanner.extractUrl(event);
        expect(result).toEqual({
            url: "https://www.bilibili.com/video/BV123/?spm=1",
            source: 'text_share',
            needsParamRemoval: true
        });
    });

    it('should return null for unrelated messages', () => {
        const event = { raw_message: "hello world" };
        expect(BilibiliMessageScanner.extractUrl(event)).toBeNull();
    });
});

describe('BvidParser', () => {
    it('should remove URL parameters', () => {
        const url = 'https://www.bilibili.com/video/BV123456?p=1&spm_id_from=333.337';
        const result = BvidParser.removeUrlParams(url);
        expect(result).toBe('https://www.bilibili.com/video/BV123456');
    });

    it('should handle invalid URLs by splitting', () => {
        const url = 'invalid-url?param=value';
        const result = BvidParser.removeUrlParams(url);
        expect(result).toBe('invalid-url');
    });

    it('should extract BV ID directly from long link', async () => {
        const url = 'https://www.bilibili.com/video/BV17x411w7KC?p=1';
        const bvId = await BvidParser.parse(url);
        expect(bvId).toBe('BV17x411w7KC');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('should parse BV ID from redirected URL', async () => {
        const b23Url = 'https://b23.tv/example';
        (axios.get as any).mockResolvedValueOnce({
            headers: { location: 'https://www.bilibili.com/video/BV17x411w7KC' },
            status: 302
        });

        const bvId = await BvidParser.parse(b23Url);
        expect(bvId).toBe('BV17x411w7KC');
    });

    it('should handle protocol-relative redirects', async () => {
        const b23Url = 'https://b23.tv/example';
        (axios.get as any).mockResolvedValueOnce({
            headers: { location: '//www.bilibili.com/video/BV17x411w7KC' },
            status: 302
        });

        const bvId = await BvidParser.parse(b23Url);
        expect(bvId).toBe('BV17x411w7KC');
    });

    it('should return null for non-video links', async () => {
        const b23Url = 'https://b23.tv/example';
        (axios.get as any).mockResolvedValueOnce({
            headers: { location: 'https://live.bilibili.com/123' },
            status: 302
        });

        const bvId = await BvidParser.parse(b23Url);
        expect(bvId).toBeNull();
    });
});

describe('BilibiliVideoParser', () => {
    it('should return correct zone name', () => {
        expect(BilibiliVideoParser.getVideoZone(1)).toBe('动画');
        expect(BilibiliVideoParser.getVideoZone(999)).toBe('未知分区');
    });

    it('should fetch video info from API', async () => {
        (axios.get as any).mockResolvedValueOnce({
            data: { code: 0, data: { title: 'Test Video' } }
        });
        const info = await BilibiliVideoParser.getVideoInfo('BV123');
        expect(info).toEqual({ title: 'Test Video' });
    });

    it('should return null when API returns error', async () => {
        (axios.get as any).mockResolvedValueOnce({
            data: { code: -400, message: '视频不存在' }
        });
        const info = await BilibiliVideoParser.getVideoInfo('BV123');
        expect(info).toBeNull();
    });

    it('should return null when API call fails', async () => {
        (axios.get as any).mockRejectedValueOnce(new Error('Network error'));
        const info = await BilibiliVideoParser.getVideoInfo('BV123');
        expect(info).toBeNull();
    });

    it('should process video info correctly', async () => {
        const mockVideoInfo = {
            title: '测试视频',
            bvid: 'BV123',
            pic: 'http://pic.jpg',
            tid: 1,
            owner: { name: '测试UP' },
            stat: {
                view: 10000,
                danmaku: 100,
                reply: 50,
                favorite: 200,
                coin: 300,
                share: 10,
                like: 500
            }
        };

        const result = await BilibiliVideoParser.processVideoInfo(mockVideoInfo);
        expect(result).toContain('测试视频');
        expect(result).toContain('BV123');
        expect(result).toContain('测试UP');
        expect(result).toContain('1.00万');
        expect(result).toContain('http://pic.jpg');
    });
});

describe('CommandHandler & App Config', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        // Mock fs behavior
        (fs.existsSync as any).mockReturnValue(false);
        (fs.promises.writeFile as any).mockResolvedValue(undefined);
        App.config = await App.loadConfig();
        App.config.owner = "12345"; // For command testing
    });

    it('should load existing config correctly', async () => {
        const mockConfig = { petPhrase: "Meow", enabled: false };
        (fs.existsSync as any).mockReturnValue(true);
        (fs.promises.readFile as any).mockResolvedValue(JSON.stringify(mockConfig));

        const loaded = await App.loadConfig();
        expect(loaded.petPhrase).toBe("Meow");
        expect(loaded.enabled).toBe(false);
        expect(loaded.commandPrefix).toBe("/bilibilibot"); // Should merge defaults
    });

    it('should handle loadConfig error by returning defaults', async () => {
        (fs.existsSync as any).mockReturnValue(true);
        (fs.promises.readFile as any).mockRejectedValue(new Error("Disk error"));

        const loaded = await App.loadConfig();
        expect(loaded.commandPrefix).toBe("/bilibilibot");
    });

    it('should handle help command', async () => {
        const [reply, shouldReply] = await CommandHandler.handleCommand('help', [], '12345', false);
        expect(shouldReply).toBe(true);
        expect(reply).toContain('命令列表');
    });

    it('should restrict admin commands to owner', async () => {
        const [reply, shouldReply] = await CommandHandler.handleCommand('enable', [], 'wrong_id', false);
        expect(reply).toContain('没有权限');
    });

    it('should add enabled group', async () => {
        await CommandHandler.addEnabledGroup('123456');
        expect(App.config.enabledGroups).toContain('123456');
        expect(fs.promises.writeFile).toHaveBeenCalled();
    });

    it('should not add duplicate groups', async () => {
        await CommandHandler.addEnabledGroup('123456');
        await CommandHandler.addEnabledGroup('123456');
        expect(App.config.enabledGroups.filter(id => id === '123456').length).toBe(1);
    });

    it('should remove enabled group', async () => {
        await CommandHandler.addEnabledGroup('123456');
        const removed = await CommandHandler.removeEnabledGroup('123456');
        expect(removed).toBe(true);
        expect(App.config.enabledGroups).not.toContain('123456');
    });

    it('should toggle global enabled state', async () => {
        await CommandHandler.setGlobalEnabled(false);
        expect(App.config.enabled).toBe(false);
    });

    it('should deny group command usage', async () => {
        const [reply, shouldReply] = await CommandHandler.handleCommand('enable', [], '12345', true);
        expect(reply).toContain('只能在私聊中使用');
    });
});

describe('NapcatService', () => {
    it('should create forward node', () => {
        const node = NapcatService.createForwardNode('Bot', '123', 'Hello');
        expect(node).toEqual({
            type: 'node',
            data: {
                name: 'Bot',
                uin: '123',
                content: 'Hello'
            }
        });
    });
});

