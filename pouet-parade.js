const V86_VGA_COLOR_DEPTH_PORT = 0x926A;

async function start(config) {
    const {
        screen,
        nav,
        demosUrl,
        force32BitColorUrl,
        dosImgUrl,
        biosUrl,
        vgaBiosUrl,
        stateUrl,
        wasmUrl,
        which,
        download,
        mode
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
    const saveStateMode = mode === 'save-state';

    // Load demo content
    const demoResponse = await fetch(demosUrl);
    const demos = await demoResponse.json();

    const force32BitColorResponse = await fetch(force32BitColorUrl);
    const force32BitColorDemos = await force32BitColorResponse.json();
    const force32BitColorDemoIds = new Set(force32BitColorDemos.map(({ id }) => id));

    // Load DOS floppy image
    const dosImgResponse = await fetch(dosImgUrl);
    const baseDosImg = new Uint8Array(await dosImgResponse.arrayBuffer());

    // Keep a copy of the booted DOS state so demo changes do not need a page reload.
    let initialState = null;
    if (!saveStateMode) {
        const stateResponse = await fetch(stateUrl);
        initialState = await stateResponse.arrayBuffer();
    }

    let currentDemo = null;
    let currentDosImg = null;
    let emulator = null;
    let pendingDemoChange = Promise.resolve();

    function getDemoUrl(demoId) {
        const url = new URL(location.href);
        url.searchParams.set('which', demoId);
        url.searchParams.delete('download');
        return `${url.pathname}${url.search}${url.hash}`;
    }

    async function getDemoContent(demo) {
        const contentUrl = `data:application/octet-stream;base64,${demo.content}`;
        const contentResponse = await fetch(contentUrl);
        return new Uint8Array(await contentResponse.arrayBuffer());
    }

    function applyVgaColorDepth(demo) {
        const force32BitColor = demo && force32BitColorDemoIds.has(demo.id);
        emulator.v86.cpu.io.port_write8(V86_VGA_COLOR_DEPTH_PORT, force32BitColor ? 1 : 0);
    }

    async function buildDosImage(demo) {
        const content = await getDemoContent(demo);
        const dosImg = new Uint8Array(baseDosImg);
        dosImg.set(content, 0x26000);
        return { dosImg, content };
    }

    function getDemoById(demoId) {
        return demos.find(({ id }) => id === demoId) ?? null;
    }

    function getRandomDemo() {
        const randomDemos = demos.filter(demo => !demo.name.includes('BBS'));
        const candidates = randomDemos.length ? randomDemos : demos;
        if (candidates.length <= 1)
            return candidates[0];

        let demo;
        do {
            demo = candidates[(Math.random() * candidates.length) | 0];
        } while (currentDemo && demo.id === currentDemo.id);
        return demo;
    }

    function setNavLink(link, demo) {
        const button = link.querySelector('button');
        if (demo) {
            link.href = getDemoUrl(demo.id);
            link.setAttribute('aria-disabled', 'false');
            if (button)
                button.disabled = false;
        } else {
            link.href = '#';
            link.setAttribute('aria-disabled', 'true');
            if (button)
                button.disabled = true;
        }
    }

    function updateDemoInfo(demo, content) {
        elements.nameLabel.innerText = demo.name;
        elements.sizeLabel.innerText = `${content.length} bytes`;

        const formatter = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
        if (demo.byType === 'group') {
            const links = demo.by
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
        setNavLink(elements.prevButton, demoIndex > 0 ? demos[demoIndex - 1] : null);
        setNavLink(elements.nextButton, demoIndex < demos.length - 1 ? demos[demoIndex + 1] : null);

        const shareUrl = `${location.href.split('?')[0]}?which=${demo.id}`;
        elements.shareLink.value = shareUrl;
    }

    async function switchDemo(demo, { updateHistory = true, replaceHistory = false, reloadEmulator = true } = {}) {
        if (!demo)
            return;

        const { dosImg, content } = await buildDosImage(demo);
        currentDemo = demo;
        currentDosImg = dosImg;
        updateDemoInfo(demo, content);
        elements.searchInput.value = '';

        if (updateHistory) {
            const state = { which: demo.id };
            if (replaceHistory)
                history.replaceState(state, '', getDemoUrl(demo.id));
            else
                history.pushState(state, '', getDemoUrl(demo.id));
        }

        if (emulator && reloadEmulator) {
            await emulator.stop();
            await emulator.restore_state(initialState.slice(0));
            await emulator.set_fda(dosImg);
            applyVgaColorDepth(demo);
            await emulator.run();
        }

        return { dosImg, content };
    }

    function queueDemoSwitch(demo, options) {
        if (saveStateMode)
            return pendingDemoChange;

        pendingDemoChange = pendingDemoChange
            .then(() => switchDemo(demo, options))
            .catch(error => {
                console.error(error);
            });
        return pendingDemoChange;
    }

    function getDemoFromLink(link) {
        const url = new URL(link.href, location.href);
        return getDemoById(url.searchParams.get('which'));
    }

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
                queueDemoSwitch(demo);
        }
    });
    elements.searchInput.addEventListener('keyup', ev => {
        if (ev.key === 'Enter') {
            const searchField = elements.searchInput.value.toLowerCase().trim();
            const demo = demos.find(v => v.name.toLowerCase().includes(searchField));
            if (demo)
                queueDemoSwitch(demo);
        }
    })

    elements.prevButton.addEventListener('click', ev => {
        ev.preventDefault();
        queueDemoSwitch(getDemoFromLink(elements.prevButton));
    });
    elements.nextButton.addEventListener('click', ev => {
        ev.preventDefault();
        queueDemoSwitch(getDemoFromLink(elements.nextButton));
    });
    elements.randButton.addEventListener('click', ev => {
        ev.preventDefault();
        queueDemoSwitch(getRandomDemo());
    });
    window.addEventListener('popstate', ev => {
        const demoId = ev.state?.which ?? new URLSearchParams(location.search).get('which');
        queueDemoSwitch(getDemoById(demoId) ?? getRandomDemo(), {
            updateHistory: false
        });
    });

    if (saveStateMode) {
        currentDosImg = new Uint8Array(baseDosImg);
        setNavLink(elements.prevButton, null);
        setNavLink(elements.nextButton, null);
        elements.randButton.href = '#';
        elements.randButton.querySelector('button').disabled = true;
        elements.searchInput.disabled = true;
        history.replaceState({ mode }, '', location.href);
    } else {
        // Select the initial demo and replace RUN.COM before v86 starts.
        let initialDemo = which ? getDemoById(which) : null;
        if (which && !initialDemo) {
            location.href = '.';
            return null;
        }
        if (!initialDemo)
            initialDemo = getRandomDemo();

        const initial = await switchDemo(initialDemo, {
            updateHistory: false,
            reloadEmulator: false
        });
        history.replaceState({ which: initialDemo.id }, '', location.href);

        if (download === 'img') {
            downloadBytes(initial.dosImg, `demo-${initialDemo.id}.img`);
        } else if (download === 'com') {
            downloadBytes(initial.content, `demo-${initialDemo.id}.com`);
        }
    }

    // Start emulator
    const v86Config = {
        bios: {
            url: biosUrl,
        },
        vga_bios: {
            url: vgaBiosUrl,
        },
        fda: {
            buffer: currentDosImg.buffer
        },
        wasm_path: wasmUrl,
        autostart: false,
        screen: {
            container: screen,
            use_graphical_text: true
        }
    };
    if (!saveStateMode) {
        v86Config.initial_state = {
            buffer: initialState.slice(0)
        };
    }
    const Emulator = window.V86 || window.V86Starter;
    if (!Emulator) {
        throw new Error('v86 failed to load');
    }

    emulator = new Emulator(v86Config);
    emulator.add_listener("emulator-loaded", async function() {
        if (saveStateMode) {
            let stateSaved = false;
            const saveStateDevice = { name: 'demo-parade-save-state' };
            const saveState = async () => {
                if (stateSaved)
                    return;

                stateSaved = true;
                const state = await emulator.save_state();
                downloadBytes(state, 'v86state.bin');
            };
            emulator.v86.cpu.io.register_write(0x9269, saveStateDevice, saveState, saveState, saveState);
        }
        await emulator.set_fda(currentDosImg);
        applyVgaColorDepth(currentDemo);
        await emulator.run();
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
const mode = params.get('mode') ?? null;

start({
    screen: document.getElementById('screen_container'),
    nav: document.querySelector('nav'),
    demosUrl: 'demos/demos.json',
    force32BitColorUrl: 'demos/force32bitColor.json',
    dosImgUrl: 'image/freedos.img',
    biosUrl: 'bios/bochs-bios.bin',
    vgaBiosUrl: 'bios/vgabios.bin',
    stateUrl: 'image/v86state.bin',
    wasmUrl: 'v86/v86.wasm',
    which,
    download,
    mode
});
