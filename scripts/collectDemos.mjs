import * as fs from 'fs/promises';
import { cacheRead, cacheWrite } from './productCache.mjs'
import { fetchProduct } from './productFetch.mjs'

const ALLOWED_TYPES = ['32b', '64b', '128b', '256b', '512b', '1k'];

function isTinyDosDemo(product) {
    const types = product.type.split(',');
    const hasAllowedType = types.some(v => ALLOWED_TYPES.includes(v));
    const isDos = Object.values(product.platforms).some(_ => _.slug === 'msdos');
    return hasAllowedType && isDos;
}

function logMessage(message) {
    console.warn(`    ${message}`);
}

const file = await fs.readFile('pouetdatadump-prods-20240403.json');
const data = JSON.parse(file);
const candidates = data.prods.filter(isTinyDosDemo)//.filter(_ => _.id === '96536');
const result = [];

let successfulCount = 0;
for (const product of candidates) {
    console.log(`ID: ${product.id}, Name: "${product.name}"`);
    try {
        let productData = await cacheRead(product);
        if (productData)
            logMessage(`read from cache`)
        else {
            productData = await fetchProduct(product, logMessage);
            await cacheWrite(product, productData);
        }

        if (productData) {
            successfulCount++;
            result.push(productData);
        }
    } catch(e) {
        // no problem - just report it
        logMessage('Error fetching product', product.download);
        logMessage(`${e.message.split('\n')[0]}`);
    }
}

// Write result
await fs.writeFile('result.json', JSON.stringify(result));

// Show stats
console.log('RESULTS:');
console.log('    - total:      ', data.prods.length)
console.log('    - candidates: ', candidates.length)
console.log('    - successful: ', successfulCount)
