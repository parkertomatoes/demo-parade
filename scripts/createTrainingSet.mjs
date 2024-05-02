import * as fs from 'fs/promises';
import { SingleBar, Presets } from 'cli-progress';

const demosText = await fs.readFile('result.json');
const demos = JSON.parse(demosText);

const progress = new SingleBar({}, Presets.shades_classic);
let current = 0;
progress.start(demos.length, current);
for (const demo of demos) {
    const bytes = Buffer.from(demo.content, 'base64url');
    await fs.writeFile(`training/${demo.id}.bin`, bytes);
    progress.update(current++);
}
progress.stop();
