import * as tmp from 'tmp-promise';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as _7z from '7zip-min';
import { promisify } from 'util';
import { execFile as execFileCallback } from 'child_process';
const unpack = promisify(_7z.unpack);
const execFile = promisify(execFileCallback);
const MAX_COM_SIZE = 1024;
const MAX_DIRECT_DOWNLOAD_SIZE = 3 * 1024;
const MAX_ARCHIVE_DEPTH = 6;
const TLS_ERROR_CODES = new Set([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_GET_ISSUER_CERT'
]);

/** 
 * Get filename from Content-Disposition header value
 */
function getFileName(disposition) {
    const utf8FilenameRegex = /filename\*=UTF-8''([\w%\-\.]+)(?:; ?|$)/i;
    const asciiFilenameRegex = /^filename=(["']?)(.*?[^\\])\1(?:; ?|$)/i;

    let fileName = null;
    if (utf8FilenameRegex.test(disposition)) {
      fileName = decodeURIComponent(utf8FilenameRegex.exec(disposition)[1]);
    } else {
      // prevent ReDos attacks by anchoring the ascii regex to string start and
      //  slicing off everything before 'filename='
      const filenameStart = disposition.toLowerCase().indexOf('filename=');
      if (filenameStart >= 0) {
        const partialDisposition = disposition.slice(filenameStart);
        const matches = asciiFilenameRegex.exec(partialDisposition );
        if (matches != null && matches[2]) {
          fileName = matches[2];
        }
      }
    }
    return fileName;
}

/**
 * For scene.org downloads, download is an HTML page with more links.
 * This function fetches the main download and returns the content as a blob
 * @param {string} text HTML source of the download
 * @returns main download content
 */
async function sceneOrgRedirect(text, baseUrl, log) {
    const pattern = /<li id='mainDownload'><a href='(.*)'>/;
    const match = pattern.exec(text);
    if (match === null) {
        log('Could not determine redirect for scene.org');
        return null;
    }
    const response = await fetchWithTlsFallback(new URL(match[1], baseUrl), undefined, log);
    if (!response.ok) {
        log(`${response.url} failed with response ${response.status}`);
        return null;
    }
    return {
        blob: await response.blob(),
        fileName: getResponseFileName(response)
    };
}

/**
 * Extract the best available filename from a fetch response.
 * @param {Response} response
 * @param {string} fallbackUrl
 */
function getResponseFileName(response, fallbackUrl = response.url) {
    const fileNameRaw = response.headers.has('Content-Disposition')
        ? getFileName(response.headers.get('Content-Disposition'))
        : fallbackUrl.split('/').pop();
    return (fileNameRaw ?? 'download').split('?')[0] || 'download';
}

function getGitHubRawUrl(sourceUrl) {
    let url;
    try {
        url = new URL(sourceUrl);
    } catch(e) {
        return null;
    }

    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com')
        return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 5 || (parts[2] !== 'blob' && parts[2] !== 'raw'))
        return null;

    return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join('/')}`;
}

function getDownloadUrl(product, log) {
    const githubRawUrl = getGitHubRawUrl(product.download);
    if (githubRawUrl !== null) {
        log(`Rewriting GitHub source page to raw download: ${githubRawUrl}`);
        return githubRawUrl;
    }

    return product.download;
}

function isComFileName(fileName) {
    return fileName.toLowerCase().endsWith('.com');
}

function isArchiveFileName(fileName) {
    return /\.(zip|rar|7z|arj|lha|lzh|tar|tgz|tbz2|txz|gz|bz2|xz)$/i.test(fileName);
}

function stripKnownExtensions(fileName) {
    let baseName = path.basename(fileName).toLowerCase();
    for (const extension of ['.tar.gz', '.tar.bz2', '.tar.xz', '.zip', '.rar', '.7z', '.arj', '.lha', '.lzh', '.gz', '.com']) {
        if (baseName.endsWith(extension)) {
            baseName = baseName.slice(0, -extension.length);
            break;
        }
    }
    return baseName;
}

function normalizeName(fileName) {
    return stripKnownExtensions(fileName).replace(/[^a-z0-9]+/g, '');
}

function scoreComCandidate(candidate, archiveName) {
    const candidateBase = normalizeName(candidate.name);
    const archiveBase = normalizeName(archiveName);
    const pathParts = candidate.name.split(path.sep).map(normalizeName).filter(Boolean);
    let score = 0;

    if (archiveBase && candidateBase === archiveBase)
        score += 1000;
    else if (archiveBase && candidateBase.includes(archiveBase))
        score += 250;
    else if (archiveBase && archiveBase.includes(candidateBase))
        score += 100;

    if (archiveBase && pathParts.includes(archiveBase))
        score += 50;

    if (/logo|nfo|info|readme|fileid|diz|url|txt/.test(candidateBase))
        score -= 500;

    score -= candidate.name.split(path.sep).length;
    score -= candidate.size / 100000;
    return score;
}

async function getComCandidates(files, contentsPath, archiveName, log) {
    const candidates = [];
    for (const filePath of files) {
        const name = path.relative(contentsPath, filePath);
        if (!isComFileName(name))
            continue;

        const stat = await fs.stat(filePath);
        if (stat.size > MAX_COM_SIZE) {
            log(`${name} is larger than ${MAX_COM_SIZE} bytes`);
            continue;
        }

        candidates.push({
            filePath,
            name,
            size: stat.size,
            score: 0
        });
    }

    for (const candidate of candidates) {
        candidate.score = scoreComCandidate(candidate, archiveName);
    }
    candidates.sort((a, b) =>
        b.score - a.score ||
        a.name.localeCompare(b.name)
    );
    return candidates;
}

function looksLikeHtml(buffer) {
    const sample = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
    return sample.startsWith('<!doctype html') || sample.startsWith('<html');
}

function makeBufferedResponse(buffer, url) {
    return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        async blob() {
            return new Blob([buffer]);
        },
        async text() {
            return buffer.toString('utf8');
        },
        async arrayBuffer() {
            return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        }
    };
}

function isTlsVerificationError(error) {
    if (!error)
        return false;
    if (TLS_ERROR_CODES.has(error.code))
        return true;
    return TLS_ERROR_CODES.has(error.cause?.code);
}

async function fetchWithTlsFallback(url, options, log) {
    const urlText = String(url);
    try {
        return await fetch(url, options);
    } catch (error) {
        if (!isTlsVerificationError(error))
            throw error;

        log(`TLS verification failed for ${urlText}; retrying with curl`);
        const { stdout } = await execFile(
            'curl',
            ['-L', '--fail', '--silent', '--show-error', '--insecure', urlText],
            {
                encoding: 'buffer',
                maxBuffer: 50 * 1024 * 1024
            }
        );
        return makeBufferedResponse(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout), urlText);
    }
}

async function walkFiles(root) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walkFiles(entryPath));
        } else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files;
}

async function readComFile(filePath, displayName, log) {
    const content = await fs.readFile(filePath);
    if (content.length > MAX_COM_SIZE) {
        log(`${displayName} is larger than ${MAX_COM_SIZE} bytes`);
        return null;
    }
    return content.toString('base64url');
}

async function extractArchive(archivePath, contentsPath) {
    try {
        await unpack(archivePath, contentsPath);
        return true;
    } catch(e) {
        // Keep going: the bundled 7zip-min binary cannot open some RARs.
    }

    const fallbacks = [
        ['7zz', ['x', '-y', archivePath, `-o${contentsPath}`]],
        ['7z', ['x', '-y', archivePath, `-o${contentsPath}`]],
        ['bsdtar', ['-xf', archivePath, '-C', contentsPath]],
        ['tar', ['-xf', archivePath, '-C', contentsPath]]
    ];

    for (const [command, args] of fallbacks) {
        try {
            await execFile(command, args, { timeout: 30000, maxBuffer: 1024 * 1024 });
            return true;
        } catch(e) {
            continue;
        }
    }
    return false;
}

/**
 * Searches a downloaded file, archive, or nested archive for a .com file and
 * returns the bytes as URL-encoded base64.
 * @param {string} fileName Name of the downloaded file
 * @param {Buffer} buffer Content of the downloaded file
 * @param {string} folder Temporary working directory
 * @param {(message: text) => void} log Function to log messages
 * @param {number} depth Archive nesting depth
 * @param {boolean} allowRawCom Whether a small, non-archive file may be treated as a direct .com
 */
async function findComContent(fileName, buffer, folder, log, depth = 0, allowRawCom = false) {
    if (looksLikeHtml(buffer)) {
        log(`${fileName} appears to be an HTML file`);
        return null;
    }

    if (!isArchiveFileName(fileName) && buffer.length > MAX_DIRECT_DOWNLOAD_SIZE) {
        log(`${fileName} is larger than ${MAX_DIRECT_DOWNLOAD_SIZE} bytes and is not an archive`);
        return null;
    }

    if (isComFileName(fileName)) {
        if (buffer.length > MAX_COM_SIZE) {
            log(`${fileName} is larger than ${MAX_COM_SIZE} bytes`);
            return null;
        }
        return buffer.toString('base64url');
    }

    if (depth >= MAX_ARCHIVE_DEPTH) {
        log(`${fileName} exceeds archive nesting limit`);
        return null;
    }

    const safeFileName = path.basename(fileName) || `download-${depth}`;
    const archivePath = path.join(folder, `${depth}-${Date.now()}-${safeFileName}`);
    await fs.writeFile(archivePath, buffer);
    if (depth === 0) {
        log(`Downloaded to: ${archivePath}`);
    }

    const contentsPath = path.join(folder, `${depth}-contents-${Date.now()}`);
    await fs.mkdir(contentsPath);
    if (!await extractArchive(archivePath, contentsPath)) {
        if (allowRawCom && buffer.length <= MAX_COM_SIZE) {
            log(`${fileName} does not look like an archive; treating it as a direct .com file`);
            return buffer.toString('base64url');
        }
        log(`Error opening archive ${fileName}`);
        return null;
    }

    const extractedFiles = await walkFiles(contentsPath);
    const comCandidates = await getComCandidates(extractedFiles, contentsPath, fileName, log);
    if (comCandidates.length > 0) {
        if (comCandidates.length > 1) {
            log(`Selected ${comCandidates[0].name} from ${comCandidates.length} .com candidates`);
        }
        return readComFile(comCandidates[0].filePath, comCandidates[0].name, log);
    }

    for (const filePath of extractedFiles) {
        const extractedName = path.relative(contentsPath, filePath);
        if (!isArchiveFileName(extractedName))
            continue;

        const content = await findComContent(
            extractedName,
            await fs.readFile(filePath),
            folder,
            log,
            depth + 1,
            false
        );
        if (content !== null)
            return content;
    }

    log(`${fileName} does not appear to contain a .com file`);
    return null;
}

/**
 * Fetches the download for a Pouet product
 * @param {object} product 
 * @param {(message: string) => void} log Logging function
 * @returns {object} A description of the product including its download, or null if not successful
 */
export async function fetchProduct(product, log) {
    // Download the product URL
    const downloadUrl = getDownloadUrl(product, log);
    const response = await fetchWithTlsFallback(downloadUrl, undefined, log);
    if (!response.ok) {
        log(`${downloadUrl} failed with response ${response.status}`);
        return null;
    }

    // Get the file contents
    let download;
    if (downloadUrl.includes('scene.org')) {
        const html = await response.text();
        download = await sceneOrgRedirect(html, response.url, log);
    } else {
        download = {
            blob: await response.blob(),
            fileName: getResponseFileName(response, downloadUrl)
        };
    }
    if (download === null) 
        return null;

    // Search the file contents for a .com file
    const folder = await tmp.dir({ unsafeCleanup: true });
    let content;
    try {
        content = await findComContent(
            download.fileName,
            Buffer.from(await download.blob.arrayBuffer()),
            folder.path,
            log,
            0,
            true
        );
    } finally {
        await folder.cleanup();
    }
    if (content === null)
        return null;

    return {
        name: product.name,
        id: product.id,
        content
    };
}
