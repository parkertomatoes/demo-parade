import * as fs from 'fs/promises'

const demosText = await fs.readFile('../demos/demos.json');
const demos = JSON.parse(demosText);

for (const demo of demos) {
    demo.content = demo.content.replaceAll('-', '+');
    demo.content = demo.content.replaceAll('_', '/');
}

await fs.writeFile('fixedBase64.json', JSON.stringify(demos));