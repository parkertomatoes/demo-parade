import * as fs from 'fs/promises';

const productFetchExceptions = JSON.parse(
    await fs.readFile(new URL('./productFetchExceptions.json', import.meta.url), 'utf8')
);

export function getProductFetchException(product) {
    return productFetchExceptions[String(product.id)] ?? null;
}

export function hasProductFetchException(product) {
    return getProductFetchException(product) !== null;
}
