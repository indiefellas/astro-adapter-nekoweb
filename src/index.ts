import fs, { existsSync, stat } from 'node:fs';
import fsp, { statfs } from 'node:fs/promises';
import archiver from 'archiver';
import path, { join } from 'node:path';
import FormData from 'form-data'; 
import { fileURLToPath } from 'node:url';

const version = '3.0.0';

import type {
	AstroConfig,
	AstroIntegration,
	AstroIntegrationLogger,
	HookParameters,
	IntegrationResolvedRoute,
} from 'astro';
import NekowebAPI, { BigFile } from '@indiefellas/nekoweb-api';
import { LogType } from '@indiefellas/nekoweb-api/types';

export interface Options {
    /**
     * Your Nekoweb API key.
     * You can get one by going to https://nekoweb.org/api
     * @description **Warning**: Putting your API key into your code is not recommended.
     */
    apiKey: string;
    /**
     * Your Nekoweb domain. Defaults to your main domain.
     * If you are using a custom domain, use that instead.
     */
    domain?: string;
    /**
     * Your Nekoweb account cookie. This is required if you want your update count to go up.
     * You can get one by following the instructions on https://deploy.nekoweb.org/#getting-your-cookie
     * @description **Warning**: Putting your account cookie into your code is not recommended.
     */
    cookie?: string;
    /**
     * Your Nekoweb site name. This is different than your domain.
     * Only used when cookie is defined.
     */
    siteName?: string;
    /**
     * Your RSS feed path relative to the output directory, if you want to update your RSS feed.
     */
    rssFeed?: string;
}

class NekoAPI extends NekowebAPI {
    private csrf: string = "";
    private site: string = "";
    ucfg: NekowebAPI | null;

    constructor(apiKey: string, logger: AstroIntegrationLogger, cookie?: string) {
        if (cookie) {
            super({
                apiKey: apiKey,
                appName: `astro-adapter-nekoweb/${version} (https://github.com/indiefellas/astro-adapter-nekoweb)`,
                logging: (type, msg) => {
                    switch (type) {
                        case LogType.Info: 
                            logger.info(msg);
                            break;
                        case LogType.Warn:
                            logger.warn(msg);
                            break;
                        case LogType.Error:
                            logger.error(msg);
                            break;
                    }
                }
            });
            this.ucfg = new NekowebAPI({
                apiKey: '',
                appName: `astro-adapter-nekoweb/${version} (https://github.com/indiefellas/astro-adapter-nekoweb)`,
                request: {
                    headers: {
                        Authorization: '',
                        Origin: 'https://nekoweb.org',
                        Host: 'nekoweb.org',
                        'User-Agent': ``,
                        Referer: `https://nekoweb.org/?${encodeURIComponent(
                            `astro-adapter-nekoweb@${version} deployment library (pls no bans)`
                        )}`,
                        Cookie: `token=${cookie}`,
                    }
                },
                logging: (type, msg) => {
                    switch (type) {
                        case LogType.Info: 
                            logger.info(msg);
                            break;
                        case LogType.Warn:
                            logger.warn(msg);
                            break;
                        case LogType.Error:
                            logger.error(msg);
                            break;
                    }
                }
            });
        } else {
            super({
                apiKey: apiKey,
                appName: 'astro-adapter-nekoweb/${version} (https://github.com/indiefellas/astro-adapter-nekoweb)',
                logging: (type, msg) => {
                    switch (type) {
                        case LogType.Info: 
                            logger.info(msg);
                            break;
                        case LogType.Warn:
                            logger.warn(msg);
                            break;
                        case LogType.Error:
                            logger.error(msg);
                            break;
                    }
                }
            })
            this.ucfg = null;
        }
    }
    
    async getCSRFToken() {
        const ures = await this.getSiteInfo()
        const domain = ures.domain;
    
        const response = await this.ucfg?.generic('/csrf', {
            method: 'GET',
        }) as ArrayBuffer;
    
        this.csrf = Buffer.from(response).toString();
        this.site = domain;
    }
    
    async editFileCSRF(path: string, content: string, siteName: string) {
		let data = new FormData() as any;
		data.append("pathname", path);
		data.append("content", content);
        data.append("site", siteName);
        data.append("csrf", this.csrf);

		return this.ucfg?.generic('/files/edit', {
			method: 'POST',
			data: data,
		})
	}

    async initFileUpload() {
        try {
            return await this.createBigFile();
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    async createBigFile(): Promise<BigFileExt> {
		let id = await this.generic<{"id": string}>('/files/big/create').then((res) => res.id)
		return new BigFileExt(id, this, this.config);
	}
}

class BigFileExt extends BigFile {
    async finalizeUpload(api: NekoAPI, logger: AstroIntegrationLogger, siteName: string, rssFeed?: string, rssContent?: string) {
        try {
            let res = this.import()

            if (!api.ucfg) {
                logger.warn('Nekoweb Cookie not found. Skipping Recently Updated support...');
                return res;
            }

            await api.getCSRFToken();
            
            if (rssFeed && rssContent) {
                const resp = await api.editFileCSRF(rssFeed, rssContent, siteName);
            }

            await api.editFileCSRF(
                '/.astro-adapter-nekoweb.html',
                `<!--
    This is an auto-generated file created by astro-adapter-nekoweb.

    This file is used to put you on the 'Last Updated' page
    on Nekoweb.

    You can delete this file if you want, but it will come
    back the next time you deploy using astro-adapter-nekoweb.
                
    https://deploy.nekoweb.org/astro
    https://github.com/indiefellas/astro-adapter-nekoweb

    ${Date.now()}
-->`, siteName);

            logger.info('Sent cookie request');
        } catch (error) {
            logger.error(`Failed to upload. ${error}`);
        }
    }
}

async function zipDirectory(source: string, out: string) {
    const archive = archiver('zip', { zlib: { level: 8 } });
    const output = fs.createWriteStream(out);
    archive.pipe(output);
    archive.directory(source, false);
    return archive.finalize();
}

export default function createIntegration(args: Options): AstroIntegration {
    return {
        name: 'astro-adapter-nekoweb',
        hooks: {
            'astro:config:done': ({ setAdapter }) => {
                setAdapter({
                    name: '@indiefellas/astro-adapter-nekoweb',
                    supportedAstroFeatures: {
                        staticOutput: 'stable',
                        serverOutput: {
                            support: 'unsupported',
                            message: 'Nekoweb is a static host and will not support SSR pages.'
                        },
                        hybridOutput: 'unsupported',
                        sharpImageService: {
                            support: 'unsupported',
                            message: 'Nekoweb does not support sharp. Use `compile` image service to compile images at build time.'
                        }
                    },
                    adapterFeatures: {
                        edgeMiddleware: false,
                        buildOutput: 'static',
                        
                    }
                });
            },
            'astro:build:done': async ({ dir, assets, logger }) => {
                if (!args.apiKey || args.apiKey === '') {
                    logger.error('Missing API key. You need to define it so you can deploy your site.');
                    throw new Error('Missing API key');
                }

                const { domain, apiKey, cookie, rssFeed, siteName } = args;
                const outDir = fileURLToPath(dir);
                const neko = new NekoAPI(apiKey, logger, cookie);
                const site = await neko.getSiteInfo(domain);
                const folder = site.folder;
                if (!folder) {
                    logger.error('Missing folder.');
                    throw new Error('Missing folder');
                }

                const tmpBuildDir = '.build-temp';
                if (fs.existsSync(tmpBuildDir))
                    fs.rmSync(tmpBuildDir, { recursive: true, force: true });
                fs.mkdirSync(tmpBuildDir);
                const zipFileName = `${folder.split('/')[0]}.zip`;
                let rssContent;
                if (rssFeed) {
                    rssContent = fs.readFileSync(join(outDir, rssFeed), 'utf-8') + `\n<!-- deployed to Nekoweb using astro-adapter-nekoweb on ${Date.now()} -->`;
                }

                if (fs.existsSync(path.join(outDir, '404.html'))) {
                    logger.info('Found 404.html, renaming it to not_found.html...')
                    fs.renameSync(path.join(outDir, '404.html'), path.join(outDir, 'not_found.html'))
                }

                fs.cpSync(outDir, tmpBuildDir + `/${folder}`, { recursive: true });
                await zipDirectory(tmpBuildDir, zipFileName);
                logger.info(`Compressed "${outDir}"`);

                const bigId = await neko.initFileUpload();
                logger.info(`Created BigFile upload session (ID: ${bigId.id})`);

                let zip = fs.readFileSync(zipFileName);
                await bigId.append(zip);
                logger.info(`Uploaded "${outDir}"`);

                try {
                    await neko.delete(folder);
                } catch (e) { }

                await bigId.finalizeUpload(neko, logger, siteName ?? '', rssFeed ? join(`/${folder}`, rssFeed): undefined, rssContent);
                logger.info(`Successfully deployed "${outDir}"`);
                await fsp.unlink(zipFileName);
                fs.rmSync(tmpBuildDir, { recursive: true, force: true });
            },
        }
    };
}