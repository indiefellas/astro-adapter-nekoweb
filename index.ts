import fs, { existsSync, stat } from 'node:fs';
import fsp, { statfs } from 'node:fs/promises';
import archiver from 'archiver';
import fetch from 'node-fetch';
import path from 'node:path';
import FormData from 'form-data'; 
import { fileURLToPath } from 'node:url';

import type {
    RequestInit
} from 'node-fetch';

import type {
	AstroConfig,
	AstroIntegration,
	AstroIntegrationLogger,
	HookParameters,
	IntegrationResolvedRoute,
} from 'astro';

export interface Options {
    /**
     * Your Nekoweb API key.
     * You can get one by going to https://nekoweb.org/api
     * @description **Warning**: Putting your API key into your code is not recommended.
     */
    apiKey?: string;
    /**
     * Your Nekoweb serve folder. Defaults to "build".
     * It must be the same as 'Serve folder' on https://nekoweb.org/settings
     * We recommend serving your site in a folder instead of on the root path as it can break stuff.
     */
    folder?: string;
    /**
     * Your Nekoweb account cookie. This is required if you want your update count to go up.
     * You can get one by following the instructions on https://deploy.nekoweb.org/#getting-your-cookie
     * @description **Warning**: Putting your account cookie into your code is not recommended.
     */
    cookie?: string;
}

let version = '2.0.3';
let nekowebApiUrl = 'https://nekoweb.org/api';

async function genericRequest(endpoint: string, options: RequestInit) {
    const response = await fetch(nekowebApiUrl + endpoint, options);
    return response;
}

function getToken(apiKey: string, cookie: string) {
    if (cookie) {
        return {
            Origin: 'https://nekoweb.org',
            Host: 'nekoweb.org',
            'User-Agent': `astro-adapter-nekoweb/${version} (https://github.com/jbcarreon123/astro-adapter-nekoweb)`,
            Referer: `https://nekoweb.org/?${encodeURIComponent(
                `astro-adapter-nekoweb@${version} deployment library (pls no bans)`
            )}`,
            Cookie: `token=${cookie}`,
        };
    } else {
        return {
            'User-Agent': `astro-adapter-nekoweb/${version} (https://github.com/jbcarreon123/astro-adapter-nekoweb)`,
            Authorization: apiKey,
        };
    }
}

async function getCSRFToken(token: any) {
    const ures = await genericRequest('/site/info', {
        method: 'GET',
        headers: token,
    });

    const username = await ures.json();

    const response = await genericRequest('/csrf', {
        method: 'GET',
        headers: {
            Origin: 'https://nekoweb.org',
            Host: 'nekoweb.org',
            'Content-Type': 'multipart/form-data',
            ...token,
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get CSRF token: ${response.status} ${response.statusText} (${await response.text()})`);
    }

    const res = await response.text();

    return [res, username['username']];
}

async function zipDirectory(source: string, out: string) {
    const archive = archiver('zip', { zlib: { level: 8 } });
    const output = fs.createWriteStream(out);
    archive.pipe(output);
    archive.directory(source, false);
    return archive.finalize();
}

async function initFileUpload(token: any) {
    try {
        const response = await genericRequest('/files/big/create', {
            method: 'GET',
            headers: token,
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create upload session: ${response.status} ${response.statusText} - ${errorText}`);
        }
        return response.json();
    } catch (error) {
        console.log(error);
        throw error;
    }
}

async function uploadFile(token: any, filePath: string, bigId: string) {
    const formData = new FormData();
    formData.append('id', bigId);
    const fileBuffer = await fsp.readFile(filePath);
    formData.append('file', fileBuffer, 'build.zip');
    const response = await fetch('https://nekoweb.org/api/files/big/append', {
        method: 'POST',
        headers: {
            ...token,
        },
        body: formData,
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upload: ${response.status} ${response.statusText} - ${errorText}`);
    }
    return response.text();
}

function getRssFile(dir: string): string {
    try {
        const files = fs.readdirSync(dir);

        for (const fileIndex in files) {
            const file = files[fileIndex];
            const filePath = path.join(dir, file);
            const stat = fs.lstatSync(filePath);
            if (stat.isDirectory()) {
                const res = getRssFile(filePath);
                if (res) {
                    return res;
                }
            } else if (file.endsWith('.xml')) {
                return filePath;
            }
        }

        return null;
    } catch (e) {
        console.error(e);
        return null;
    }
}

async function finalizeUpload(apiToken: any, token: any, bigId: string, rssFile: string, rssContent: string, logger: AstroIntegrationLogger) {
    const response = await genericRequest(`/files/import/${bigId}`, {
        method: 'POST',
        headers: {
            ...apiToken,
        },
    });
    if (!response.ok) {
        throw new Error(`Failed to import: ${response.status} ${response.statusText} (${await response.text()})`);
    } else if (!token['Cookie']) {
        logger.warn('Nekoweb Cookie not found. Skipping Recently Updated support...')
        return response.text();
    }

    const [csrfToken, username] = await getCSRFToken(token);

    if (rssFile && rssContent) {
        const formData = new FormData();
        formData.append('csrf', csrfToken);
        formData.append('site', username);

        formData.append('pathname', rssFile);
        formData.append('content', rssContent);
        const resp = await genericRequest('/files/edit', {
            method: 'POST',
            body: formData,
            headers: {
                ...token,
            },
        });
        if (!resp.ok) {
            logger.error(`Failed to send RSS cookie request: ${resp.status} ${resp.statusText} (${await resp.text()})`);
        }
    }

    const formData = new FormData();
    formData.append('csrf', csrfToken);
    formData.append('site', username);
    formData.append('pathname', `.astro-adapter-nekoweb.html`);
    formData.append('content', `<!-- deployed to Nekoweb using @indiefellas/astro-adapter-nekoweb on ${new Date(Date.now()).toString()} -->`);
    const resp = await genericRequest('/files/edit', {
        method: 'POST',
        body: formData,
        headers: {
            ...token,
        },
    });
    if (!resp.ok) {
        logger.error(`Failed to send cookie request: ${resp.status} ${resp.statusText} (${await resp.text()})`);
    } else {
        logger.info('Sent cookie request');
    }
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
                } else if (!args.folder || args.folder === '') {
                    logger.error('Missing serve folder.');
                    throw new Error('Missing serve directory');
                }

                const { apiKey, cookie, folder = 'build' } = args;
                const outDir = fileURLToPath(dir)

                const token = getToken(apiKey, cookie);
                const apiToken = getToken(apiKey, null);

                const tmpBuildDir = '.build-temp';
                if (fs.existsSync(tmpBuildDir))
                    fs.rmSync(tmpBuildDir, { recursive: true, force: true });
                fs.mkdirSync(tmpBuildDir);
                const zipFileName = `${folder}.zip`;
                const rssFile = getRssFile(outDir);
                let rssContent;
                if (rssFile) {
                    rssContent = fs.readFileSync(rssFile, 'utf-8') + `\n`;
                }

                fs.cpSync(outDir, tmpBuildDir + `/${folder}`, { recursive: true });
                await zipDirectory(tmpBuildDir, zipFileName);
                logger.info(`Compressed "${outDir}"`);

                const bigId = await initFileUpload(apiToken);
                logger.info(`Created BigFile upload session (ID: ${bigId.id})`);

                await uploadFile(apiToken, zipFileName, bigId.id);
                logger.info(`Uploaded "${outDir}"`);

                try {
                    await genericRequest('/files/delete', {
                        method: 'POST',
                        headers: {
                            ...token,
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        body: `pathname=${folder}`,
                    });
                } catch (e) { }

                await finalizeUpload(apiToken, token, bigId.id, rssFile, rssContent, logger);
                logger.info(`Successfully deployed "${outDir}"`);
                await fsp.unlink(zipFileName);
                fs.rmSync(tmpBuildDir, { recursive: true, force: true });
            },
        }
    };
}