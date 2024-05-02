import * as zstd from '@bokuweb/zstd-wasm';
import * as fs from 'fs/promises';

zstd.init();
const dict = await fs.readFile('training.dict');
const demosText = await fs.readFile('result.json');
const demos = JSON.parse(demosText);

const sizes = new Set();

for (const demo of demos) {
    const bytes = Buffer.from(demo.content, 'base64url');
    sizes.add(bytes.length);
    const compressed = zstd.compressUsingDict(zstd.createCCtx(), bytes, dict, 10);
    demo.content = Buffer.from(compressed).toString('base64url');
}

const result = JSON.stringify({
    dict: dict.toString('base64url'),
    demos
});

const sizesArr = Array.from(sizes);
sizesArr.sort();
console.log(sizesArr);

await fs.writeFile('demos.json', result);

