(async () => {
    function waitForJupyterLite() {
        return new Promise((resolve) => {
            const check = () => {
                const app = /** @type {any} */ (window).jupyterapp || /** fallback */ (window).app;
                if (app && app.serviceManager?.contents) {
                    resolve(app);
                } else {
                    requestAnimationFrame(check);
                }
            };
            check();
        });
    }

    async function ensureDir(contents, dirPath) {
        if (!dirPath) return;
        try {
            await contents.get(dirPath);
            return; // already exists
        } catch {
            const parts = dirPath.split('/');
            if (parts.length > 1) {
                await ensureDir(contents, parts.slice(0, -1).join('/'));
            }
            const parent = parts.slice(0, -1).join('/');
            const tmp = await contents.newUntitled({ path: parent, type: 'directory' });
            await contents.rename(tmp.path, dirPath);
        }
    }

    async function copyDirectory(contents, srcDir, dstDir) {
        await ensureDir(contents, dstDir);

        let listing;
        try {
            listing = await contents.get(srcDir, { content: true });
        } catch (err) {
            console.error(`Unable to read ${srcDir}:`, err);
            return;
        }
        if (listing.type !== 'directory') return;

        for (const item of listing.content) {
            const srcPath = `${srcDir}/${item.name}`;
            const dstPath = `${dstDir}/${item.name}`;

            if (item.type === 'directory') {
                await copyDirectory(contents, srcPath, dstPath);
            } else {
                let exists = true;
                try {
                    await contents.get(dstPath);
                } catch {
                    exists = false;
                }
                if (exists) continue; // keep user edits

                const full = await contents.get(srcPath, {
                    content: true,
                    format: item.format || (item.type === 'notebook' ? 'json' : 'text'),
                });
                await ensureDir(contents, dstDir);
                await contents.save(dstPath, {
                    type: full.type,
                    format: full.format,
                    content: full.content,
                });
            }
        }
    }

    // In this project, all notebooks live directly in the given directory on
    // GitHub, so we don't need to traverse sub-folders. We simply list that one
    // folder and keep the `.ipynb` files.
    async function listGitHubNotebooks(repo, dirPath) {
        const apiUrl = `https://api.github.com/repos/${repo}/contents/${dirPath}?ref=main`;
        const resp = await fetch(apiUrl);
        if (!resp.ok) {
            throw new Error(`Failed to list ${dirPath} from ${repo}: ${resp.status}`);
        }
        /** @type {Array<any>} */
        const items = await resp.json();
        return items
            .filter((item) => item.type === 'file' && item.name.endsWith('.ipynb'))
            .map((item) => ({ path: item.path, download_url: item.download_url }));
    }

    async function fetchNotebookRaw(downloadUrl) {
        const resp = await fetch(downloadUrl);
        if (!resp.ok) {
            throw new Error(`Failed to download notebook ${downloadUrl}: ${resp.status}`);
        }
        const text = await resp.text();
        return JSON.parse(text);
    }

    async function populateEinopsNotebooks(contents) {
        const repo = 'arogozhnikov/einops';
        const srcDirInRepo = 'docs';
        const dstRoot = 'notebooks';

        let list;
        try {
            list = await listGitHubNotebooks(repo, srcDirInRepo);
        } catch (err) {
            console.error('[populate-notebooks] Listing notebooks failed:', err);
            return;
        }

        for (const nb of list) {
            const relPath = nb.path.replace(new RegExp(`^${srcDirInRepo}/`), '');
            const dstPath = `${dstRoot}/${relPath}`;

            let exists = true;
            try {
                await contents.get(dstPath);
            } catch {
                exists = false;
            }
            if (exists) continue;

            let nbJson;
            try {
                nbJson = await fetchNotebookRaw(nb.download_url);
            } catch (err) {
                console.error(err);
                continue;
            }

            const parentDir = dstPath.split('/').slice(0, -1).join('/');
            await ensureDir(contents, parentDir);

            await contents.save(dstPath, {
                type: 'notebook',
                format: 'json',
                content: nbJson,
            });
        }
        console.info('[populate-notebooks] einops notebooks copied to /notebooks');
    }

    const app = await waitForJupyterLite();
    await app.started;

    const contents = app.serviceManager.contents;


    try {
        await copyDirectory(contents, 'files', 'notebooks');
        console.info('[populate-notebooks] Default notebooks are available in /notebooks');
    } catch (err) {
        console.error('[populate-notebooks] Failed to copy built-in files:', err);
    }

    // 2) Fetch remote einops notebooks
    await populateEinopsNotebooks(contents);
})();
