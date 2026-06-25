async function start(config) {
    const {
        screen,
        nav,
        demosUrl,
        dosImgUrl,
        biosUrl,
        vgaBiosUrl,
        stateUrl,
        wasmUrl,
        which,
        download
    } = config;

    const elements = {
        nameLabel: nav.querySelector('.demoName'),
        authorLabel: nav.querySelector('.demoAuthor'),
        sizeLabel: nav.querySelector('.demoSize'),
        sourceLink: nav.querySelector('.demoLink'),
        prevButton: nav.querySelector('.demoPrev'),
        randButton: nav.querySelector('.demoRand'),
        nextButton: nav.querySelector('.demoNext'),
        shareLink: nav.querySelector('.demoShare'),
        searchInput: nav.querySelector('.demoSearch input'),
        demoNameList: nav.querySelector('.demoSearch datalist')
    };

    // Load demo content
    const demoResponse = await fetch(demosUrl);
    const demos = await demoResponse.json();

    // Load DOS floppy image
    const dosImgResponse = await fetch(dosImgUrl);
    const dosImg = new Uint8Array(await dosImgResponse.arrayBuffer());

    // Select a random demo and replace RUN.COM
    let demo;
    if (which) {
        demo = demos.find(({ id }) => id === which);
        if (!demo)
            location.href = '.';
    }
    if (!demo)
        demo = demos[(Math.random() * demos.length) | 0];
    const contentUrl = `data:application/octet-stream;base64,${demo.content}`;
    const contentResponse = await fetch(contentUrl);
    const content = new Uint8Array(await contentResponse.arrayBuffer());
    dosImg.set(content, 0x26000);
    if (download === 'img') {
        downloadBytes(dosImg, `demo-${demo.id}.img`);
    } else if (download === 'com') {
        downloadBytes(content, `demo-${demo.id}.com`);
    }

    // Fill in links
    elements.nameLabel.innerText = demo.name;
    elements.sizeLabel.innerText = `${content.length} bytes`;

    const formatter = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
    if (demo.byType === 'group') {
        const links = elements.authorLabel.innerHTML = demo.by
            .map(({ id, name }) => 
                `<a href="https://www.pouet.net/groups.php?which=${id}">${name}</a>`);
        elements.authorLabel.innerHTML = `by ${formatter.format(links)}`;
    } else if (demo.byType === 'user') {
        const links = demo.by
            .map(({ id, name }) => 
                `<a href="https://www.pouet.net/user.php?who=${id}">${name}</a>`);
        elements.authorLabel.innerHTML = `by ${formatter.format(links)}`;
    } else {
        const links = demo.by
            .map(({ id, name }) => 
                `<a href="https://www.pouet.net/user.php?who=${id}">${name}</a>`);
        elements.authorLabel.innerHTML = `uploaded to pouet by ${formatter.format(links)}`;
    }
    elements.sourceLink.href = `https://www.pouet.net/prod.php?which=${demo.id}`; 
    
    const demoIndex = demos.findIndex(({ id }) => id === demo.id);
    if (demoIndex == 0) 
        elements.prevButton.disabled = true;
    else {
        const prevId = demos[demoIndex - 1].id;
        elements.prevButton.href = `?which=${prevId}`;
    }
    if (demoIndex === demos.length - 1) 
        elements.nextButton.disabled = true;
    else {
        const nextId = demos[demoIndex + 1].id;
        elements.nextButton.href = `?which=${nextId}`;
    }

    const shareUrl = `${location.href.split('?')[0]}?which=${demo.id}`
    elements.shareLink.value = shareUrl;

    // Add search fields
    const df = document.createDocumentFragment();
    for (const demo of demos) {
        const option = document.createElement('option');
        option.setAttribute('value', `${demo.name}\u2063`);
        option.textContent = `${~~(demo.content.length * 3 / 4)} bytes`;
        df.appendChild(option);
    }
    elements.demoNameList.appendChild(df);
    elements.searchInput.addEventListener('change', () => {
        if (elements.searchInput.value.endsWith('\u2063')) {
            // Invisible character means user selected from data list
            const name = elements.searchInput.value.slice(0, -1);
            const demo = demos.find(v => v.name === name);
            if (demo)
                location.href = `?which=${demo.id}`;
        }
    });
    elements.searchInput.addEventListener('keyup', ev => {
        if (ev.key === 'Enter') {
            const searchField = elements.searchInput.value.toLowerCase().trim();
            const demo = demos.find(v => v.name.toLowerCase().includes(searchField));
            if (demo)
                location.href = `?which=${demo.id}`;
        }
    })

    // Start emulator
    const v86Config = {
        bios: {
            url: biosUrl,
        },
        vga_bios: {
            url: vgaBiosUrl,
        },
        fda: {
            buffer: dosImg.buffer
        },
        initial_state: {
            url: stateUrl
        },
        wasm_path: wasmUrl,
        autostart: true,
        screen: {
            container: screen,
            use_graphical_text: true
        }
    };
    const Emulator = window.V86 || window.V86Starter;
    if (!Emulator) {
        throw new Error('v86 failed to load');
    }

    const emulator = new Emulator(v86Config);
    emulator.add_listener("emulator-loaded", async function() {
        emulator.set_fda(dosImg);
    });

    return emulator;
}

function downloadBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

const params = new URLSearchParams(location.search);
const which = params.get('which') ?? null;
const download = params.get('download') ?? null;

start({
    screen: document.getElementById('screen_container'),
    nav: document.querySelector('nav'),
    demosUrl: 'demos/demos.json',
    dosImgUrl: 'image/freedos.img',
    biosUrl: 'bios/bochs-bios.bin',
    vgaBiosUrl: 'bios/vgabios.bin',
    stateUrl: 'image/v86state.bin',
    wasmUrl: 'v86/v86.wasm',
    which,
    download
});
