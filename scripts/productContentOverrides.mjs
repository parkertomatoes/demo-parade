import * as fs from 'fs/promises';

const productContentOverrides = JSON.parse(
    await fs.readFile(new URL('./productContentOverrides.json', import.meta.url), 'utf8')
);

export function applyProductContentOverride(productData) {
    if (!productData)
        return productData;

    const content = productContentOverrides[String(productData.id)];
    if (content === undefined)
        return productData;

    return {
        ...productData,
        content: Buffer.from(content, 'base64').toString('base64url')
    };
}
