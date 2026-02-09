import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BvidParser, BilibiliVideoParser, CommandHandler, App } from './lib.ts';
import axios from 'axios';
import fs from 'fs';

vi.mock('axios');
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs') as typeof import('fs');
    return {
        ...actual,
        existsSync: vi.fn(),
        promises: {
            writeFile: vi.fn(),
            readFile: vi.fn(),
        }
    };
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

    it('should parse BV ID from redirected URL', async () => {
        const b23Url = 'https://b23.tv/example';
        (axios.get as any).mockResolvedValueOnce({
            headers: { location: 'https://www.bilibili.com/video/BV17x411w7KC' },
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

    it('should process video info correctly', async () => {
        const mockVideoInfo = {
            title: '测试视频',
            bvid: 'BV123',
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
        expect(result).toContain('1.00万'); // 10000 formatted
    });
});

describe('CommandHandler & App Config', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset App.config
        (fs.existsSync as any).mockReturnValue(false);
        (fs.promises.writeFile as any).mockResolvedValue(undefined);
        App.config = await App.loadConfig();
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

    it('should return false when removing non-existent group', async () => {
        const removed = await CommandHandler.removeEnabledGroup('non-existent');
        expect(removed).toBe(false);
    });

    it('should toggle global enabled state', async () => {
        await CommandHandler.setGlobalEnabled(false);
        expect(App.config.enabled).toBe(false);
        await CommandHandler.setGlobalEnabled(true);
        expect(App.config.enabled).toBe(true);
    });
});
