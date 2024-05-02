import * as fs from 'fs/promises';

const cacheDirCreated = false;
async function createCacheDir() {
    try {
        if (!cacheDirCreated) {
            await fs.mkdir('cache');
            cacheDirCreated = true;
        }
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

export async function cacheRead(product) {
    await createCacheDir();

    try {
        const id = parseInt(product.id);
        if (!id)
            return null;
        const cached = await fs.readFile(`cache/${id}.json`);
        return JSON.parse(cached);
    } catch(e) {
        return null;
    }
}

export async function cacheWrite(product, result) {
    await createCacheDir();
    
    try {
        const id = parseInt(product.id);
        if (!id)
            return null;
        const data = JSON.stringify(result);
        await fs.writeFile(`cache/${id}.json`, data);
    } catch(e) {
        console.log(e.message);
        // ok to ignore cache write errors
    }
}


