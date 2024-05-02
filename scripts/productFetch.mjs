import * as tmp from 'tmp-promise';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as _7z from '7zip-min';
import { promisify } from 'util';
const list = promisify(_7z.list);
const unpack = promisify(_7z.unpack);

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
async function sceneOrgRedirect(text, log) {
    const pattern = /<li id='mainDownload'><a href='(.*)'>/;
    const match = pattern.exec(text);
    if (match === null) {
        log('Could not determine redirect for scene.org');
        return null;
    }
    const response = await fetch(match[1]);
    return await response.blob();
}

/**
 * Get blob bytes and convert to base64
 * @param {Blob} blob 
 */
async function getBase64(blob) {
    const arrayBuffer = Buffer.from(await blob.arrayBuffer());
    return arrayBuffer.toString('base64url');
}

/**
 * Searches an archive for a .com file and returns the bytes as URL-encoded base64
 * @param {string} fileName Name of the archive
 * @param {Blob} blob Content of the archive
 * @param {(message: text) => void} log Function to log messages
 * @returns 
 */
async function searchArchive(fileName, blob, log) {
    if ((await blob.text()).startsWith('<!DOCTYPE html')) {
        log(`${fileName} appears to be an HTML file`);
        return null;
    }

    // Cache the archvie in a temporary directory
    const folder = await tmp.dir();
    const archivePath = path.join(folder.path, fileName); 
    const buffer = Buffer.from( await blob.arrayBuffer() );
    await fs.writeFile(archivePath, buffer);
    log(`Downloaded to: ${archivePath}`);

    // Search archive for .com file
    let files;
    try {
        files = await list(archivePath);
    } catch(e) {
        log('Error opening archive');
        return null;
    }

    const comFile = files.find(v => v.name.toLowerCase().endsWith('.com'))?.name ?? null;
    if (comFile === null) {
        log(`${fileName} does not appear to contain a .com file`)
        return null;
    }

    // Extract .com file and return contents
    const contentsPath = path.join(folder.path, '_zipContent');
    const comPath = path.join(contentsPath, comFile);
    await fs.mkdir(contentsPath);
    await unpack(archivePath, contentsPath);
    const content = await fs.readFile(comPath);
    if (content.length > 1024) {
        log(`${comFile} is larger than 1024 bytes`);
        return null;
    }
    return content.toString('base64url');
}

/**
 * Fetches the download for a Pouet product
 * @param {object} product 
 * @param {(message: string) => void} log Logging function
 * @returns {object} A description of the product including its download, or null if not successful
 */
export async function fetchProduct(product, log) {
    // Download the product URL
    const response = await fetch(product.download);
    if (!response.ok) {
        log(`${product.download} failed with response`, response.status);
        return null;
    }

    // Extract the filename from the Content-Disposition header
    const fileNameRaw = response.headers.has('Content-Disposition')
        ? getFileName(response.headers.get('Content-Disposition'))
        : product.download.split('/').pop();
    const fileName = fileNameRaw.split('?')[0];
    
    // Get the file contents
    let blob;
    if (product.download.includes('scene.org')) {
        const html = await response.text();
        blob = await sceneOrgRedirect(html, log);
    } else {
        blob = await response.blob();
    }
    if (blob === null) 
        return null;

    // Search the file contents for a .com file
    const content = await (fileName.toLowerCase().endsWith('.com')
        ? getBase64(blob)
        : searchArchive(fileName, blob, log));
    if (content === null)
        return null;

    return {
        name: product.name,
        id: product.id,
        content
    };
}
