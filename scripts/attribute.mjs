import * as fs from 'fs/promises'

const demosText = await fs.readFile('../demos/demos.json');
const demos = JSON.parse(demosText);

const pouetText = await fs.readFile('pouetdatadump-prods-20240403.json');
const pouet = JSON.parse(pouetText);

for (const demo of demos) {
    const source = pouet.prods.find(p => p.id === demo.id);

    if (source.groups.length > 0) {
        // Use group if available
        demo.byType = "group";
        demo.by = source.groups.map(({ id, name }) => ({ id, name }));
    } else if  (source.credits.length > 0) {
        // If no group, use individual credits
        demo.byType = "user";
        demo.by = source.credits.map(({ user }) => ({ id: user.id, name: user.nickname }));
    } else {
        // No group and no credits, just use uploader
        demo.byType = "upload";
        demo.by = [{ id: source.addedUser.id, name: source.addedUser.nickname }];
    }
}

await fs.writeFile('demosWithCredit.json', JSON.stringify(demos));