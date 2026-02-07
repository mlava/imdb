import iziToast from "izitoast";

const COMMAND_LABEL = "IMDb import";
const SMARTBLOCK_COMMAND = "IMDB";
const APPEND_ORDER_CACHE_LIMIT = 200;
let smartblocksLoadedHandler = null;
let isImportInFlight = false;
let isExtensionLoaded = false;
let isUnloading = false;
let activeAbortController = null;
const appendOrderCache = new Map();

// copied and adapted from https://github.com/dvargas92495/roamjs-components/blob/main/src/writes/createBlock.ts
const createBlock = async (params) => {
    const uid = window.roamAlphaAPI?.util?.generateUID?.();
    if (!uid || !window.roamAlphaAPI?.createBlock) {
        throw new Error("Roam block write APIs are unavailable.");
    }
    await window.roamAlphaAPI.createBlock({
        location: {
            "parent-uid": params.parentUid,
            order: params.order,
        },
        block: {
            uid,
            string: params.node.text
        }
    });
    for (let order = 0; order < (params.node.children || []).length; order++) {
        await createBlock({ parentUid: uid, order, node: params.node.children[order] });
    }
};

const getSettingString = (extensionAPI, key, fallback) => {
    const value = extensionAPI.settings.get(key);
    return typeof value === "string" && value.trim() ? value : fallback;
};

const escapeHtml = (value) =>
    String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const normaliseText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const sanitiseRoamInline = (value) =>
    normaliseText(value)
        .replace(/\[\[/g, "(")
        .replace(/\]\]/g, ")")
        .replace(/\[/g, "(")
        .replace(/\]/g, ")")
        .replace(/::/g, ":\u200B:");

const sanitiseRoamPlainText = (value) =>
    sanitiseRoamInline(value).replace(/#/g, "(#)");

const hasVisibleText = (value) => normaliseText(value).length > 0;

const withImportLock = async (task, onBusy = null) => {
    if (isUnloading) return null;
    if (isImportInFlight) {
        if (typeof onBusy === "function") onBusy();
        return null;
    }
    isImportInFlight = true;
    try {
        return await task();
    } finally {
        isImportInFlight = false;
    }
};

const getAppendOrder = async (roam, parentUid) => {
    if (!roam || !parentUid) return 0;
    const cached = appendOrderCache.get(parentUid);
    if (cached && (Date.now() - cached.ts) < 10000) {
        return cached.nextOrder;
    }
    if (roam.q) {
        try {
            const maxOrder = await roam.q(
                `[:find (max ?o) .
                  :where
                    [?p :block/uid "${parentUid}"]
                    [?c :block/parent ?p]
                    [?c :block/order ?o]]`
            );
            if (Number.isFinite(maxOrder)) {
                const nextOrder = maxOrder + 1;
                setAppendOrderCache(parentUid, nextOrder);
                return nextOrder;
            }
        } catch (e) {
            // Fall back to pull-based order lookup.
        }
    }
    const parentData = roam.pull?.("[:block/children [:block/order]]", [":block/uid", parentUid]);
    const children = parentData?.[":block/children"];
    if (!Array.isArray(children) || !children.length) return 0;
    const orders = children
        .map((c) => Number(c?.[":block/order"]))
        .filter((n) => Number.isFinite(n));
    const nextOrder = !orders.length ? children.length : Math.max(...orders) + 1;
    setAppendOrderCache(parentUid, nextOrder);
    return nextOrder;
};

const setAppendOrderCache = (parentUid, nextOrder) => {
    if (!parentUid) return;
    if (appendOrderCache.size >= APPEND_ORDER_CACHE_LIMIT && !appendOrderCache.has(parentUid)) {
        const oldestKey = appendOrderCache.keys().next().value;
        if (oldestKey) appendOrderCache.delete(oldestKey);
    }
    appendOrderCache.set(parentUid, { nextOrder, ts: Date.now() });
};

const fetchJson = async (url) => {
    if (isUnloading) throw new Error("Extension unloading");
    const controller = new AbortController();
    activeAbortController = controller;
    try {
        const response = await fetch(url, { signal: controller.signal });
        return await response.json();
    } finally {
        if (activeAbortController === controller) {
            activeAbortController = null;
        }
    }
};

const maybeRenamePageTitle = async (roam, pageUid, nextTitle) => {
    const title = normaliseText(nextTitle);
    if (!roam || !pageUid || !title) return;
    const currentTitle = roam.pull?.("[:node/title]", [":block/uid", pageUid])?.[":node/title"] || "";
    if (currentTitle === title) return;
    const confirmed = await confirmRenamePrompt(currentTitle, title);
    if (!confirmed) return;
    if (roam.data?.page?.update) {
        await roam.data.page.update({ page: { uid: pageUid, title } });
        return;
    }
    if (roam.updatePage) {
        await roam.updatePage({ page: { uid: pageUid, title } });
    }
};

const ORDER_OPTIONS = ["1", "2", "3", "4", "5", "6"];

const ADVANCED_OUTPUT_FIELDS = [
    {
        id: "imdb-director",
        name: "Director heading",
        description: "Preferred heading text for Director field",
        placeholder: "Director",
        orderId: "imdb-director-position",
        orderName: "Director heading order",
        orderDescription: "Preferred order for Director field",
    },
    {
        id: "imdb-writer",
        name: "Writer heading",
        description: "Preferred heading text for Writer field",
        placeholder: "Writer",
        orderId: "imdb-writer-position",
        orderName: "Writer heading order",
        orderDescription: "Preferred order for Writer field",
    },
    {
        id: "imdb-cast",
        name: "Cast heading",
        description: "Preferred heading text for Cast field",
        placeholder: "Cast",
        orderId: "imdb-cast-position",
        orderName: "Cast heading order",
        orderDescription: "Preferred order for Cast field",
    },
    {
        id: "imdb-year",
        name: "Release Year heading",
        description: "Preferred heading text for release year field",
        placeholder: "Year",
        orderId: "imdb-year-position",
        orderName: "Release Year heading order",
        orderDescription: "Preferred order for Release Year field",
    },
    {
        id: "imdb-genre",
        name: "Genre heading",
        description: "Preferred heading text for genre field",
        placeholder: "Genre",
        orderId: "imdb-genre-position",
        orderName: "Genre heading order",
        orderDescription: "Preferred order for Genre field",
    },
    {
        id: "imdb-rating",
        name: "Ratings heading",
        description: "Preferred heading text for ratings field",
        placeholder: "Ratings",
        orderId: "imdb-rating-position",
        orderName: "Ratings heading order",
        orderDescription: "Preferred order for Ratings field",
    },
];

const getOutputFieldOrder = (extensionAPI, key, fallback) => {
    const raw = extensionAPI.settings.get(key);
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(6, Math.max(1, Math.trunc(n)));
};

const buildSettingsConfig = (extensionAPI) => {
    const showAdvanced = extensionAPI.settings.get("imdb-advanced-output-options") === true;
    const settings = [
        {
            id: "imdb-apiKey",
            name: "OMDb API key",
            description: "Your API Key from http://www.omdbapi.com/apikey.aspx",
            action: { type: "input", placeholder: "Add OMDb API key here" },
        },
        {
            id: "imdb-attributes",
            name: "Output as attributes",
            description: "Import each field using Roam atributes",
            action: { type: "switch" },
        },
        {
            id: "imdb-insert-position",
            name: "Insert position",
            description: "Choose where imported blocks are inserted",
            action: { type: "select", items: ["top", "last"] },
        },
        {
            id: "imdb-rewrite-page-title",
            name: "Rewrite Roam Page Title",
            description: "Use the IMDb movie name as page title",
            action: {
                type: "switch",
                value: extensionAPI.settings.get("imdb-rewrite-page-title") === true,
            },
        },
        {
            id: "imdb-advanced-output-options",
            name: "Advanced Output Options",
            description: "Show custom heading and output order controls",
            action: {
                type: "switch",
                value: showAdvanced,
                onChange: () => {
                    setTimeout(() => {
                        extensionAPI.settings.panel.create(buildSettingsConfig(extensionAPI));
                    }, 60);
                },
            },
        },
    ];

    if (showAdvanced) {
        ADVANCED_OUTPUT_FIELDS.forEach((field) => {
            settings.push(
                {
                    id: field.id,
                    name: field.name,
                    description: field.description,
                    action: { type: "input", placeholder: field.placeholder },
                },
                {
                    id: field.orderId,
                    name: field.orderName,
                    description: field.orderDescription,
                    action: { type: "select", items: ORDER_OPTIONS },
                }
            );
        });
    }

    return {
        tabTitle: "IMDb import",
        settings,
    };
};

export default {
    onload: ({ extensionAPI }) => {
        if (isExtensionLoaded) return;
        isExtensionLoaded = true;
        isUnloading = false;
        extensionAPI.settings.panel.create(buildSettingsConfig(extensionAPI));
        const roam = window.roamAlphaAPI;
        const canUseCommandPalette = !!roam?.ui?.commandPalette?.addCommand;
        const canUsePull = !!roam?.pull;
        const canReadOpenUid = !!roam?.ui?.mainWindow?.getOpenPageOrBlockUid;
        const canCreateBlocks = !!roam?.createBlock && !!roam?.util?.generateUID;

        if (canUseCommandPalette) {
            roam.ui.commandPalette.addCommand({
                label: COMMAND_LABEL,
                callback: async () => {
                    if (!canUsePull || !canReadOpenUid || !canCreateBlocks) {
                        sendErrorAlert("IMDb import is unavailable because required Roam APIs are missing.");
                        return;
                    }

                    try {
                        await withImportLock(async () => {
                            const uid = roam.ui.getFocusedBlock?.()?.["block-uid"];
                            const blocks = await fetchIMDbCore(uid);
                            if (!Array.isArray(blocks) || !blocks.length) return;

                            let parentUid = null;
                            if (uid) {
                                const pageId = roam.pull("[:block/page]", [":block/uid", uid])?.[":block/page"]?.[":db/id"];
                                parentUid = pageId ? roam.pull("[:block/uid]", pageId)?.[":block/uid"] : null;
                            }
                            if (!parentUid) {
                                parentUid = await roam.ui.mainWindow.getOpenPageOrBlockUid();
                            }
                            if (!parentUid) return;

                            const insertPosition = getSettingString(extensionAPI, "imdb-insert-position", "top");
                            let baseOrder = 0;
                            if (insertPosition === "last") {
                                baseOrder = await getAppendOrder(roam, parentUid);
                            }

                            for (let i = 0; i < blocks.length; i++) {
                                if (isUnloading) return;
                                try {
                                    await createBlock({
                                        parentUid,
                                        order: baseOrder + i,
                                        node: blocks[i]
                                    });
                                    setAppendOrderCache(parentUid, baseOrder + i + 1);
                                } catch (e) {
                                    appendOrderCache.delete(parentUid);
                                    throw e;
                                }
                            }
                        }, () => sendInfoAlert("IMDb import is already running."));
                    } catch (e) {
                        sendErrorAlert("IMDb import failed. Please try again.");
                    }
                },
            });
        }

        const args = {
            text: SMARTBLOCK_COMMAND,
            help: "Import film data from IMDb",
            handler: (context) => fetchIMDb,
        };

        if (window.roamjs?.extension?.smartblocks) {
            window.roamjs.extension.smartblocks.registerCommand(args);
        } else {
            if (smartblocksLoadedHandler) {
                document.body.removeEventListener("roamjs:smartblocks:loaded", smartblocksLoadedHandler);
            }
            smartblocksLoadedHandler = () =>
                window.roamjs?.extension?.smartblocks &&
                window.roamjs.extension.smartblocks.registerCommand(args);
            document.body.addEventListener(
                "roamjs:smartblocks:loaded",
                smartblocksLoadedHandler,
                { once: true }
            );
        }

        async function fetchIMDb(uid) {
            const maybeBlocks = await withImportLock(
                () => fetchIMDbCore(uid),
                () => sendInfoAlert("IMDb import is already running.")
            );
            return Array.isArray(maybeBlocks) ? maybeBlocks : [];
        }

        async function fetchIMDbCore(uid) {
            if (!canUsePull || !canReadOpenUid) {
                sendErrorAlert("IMDb import is unavailable because required Roam APIs are missing.");
                return [];
            }

            const apiKey = getSettingString(extensionAPI, "imdb-apiKey", "");
            if (!apiKey) {
                sendConfigAlert();
                return [];
            }

            const imdbDirector = getSettingString(extensionAPI, "imdb-director", "Director");
            const imdbWriter = getSettingString(extensionAPI, "imdb-writer", "Writer");
            const imdbCast = getSettingString(extensionAPI, "imdb-cast", "Cast");
            const imdbYear = getSettingString(extensionAPI, "imdb-year", "Year");
            const imdbGenre = getSettingString(extensionAPI, "imdb-genre", "Genre");
            const imdbRatingString = getSettingString(extensionAPI, "imdb-rating", "Ratings");

            let pageTitle = "";
            let targetPageUid = null;
            try {
                if (uid) {
                    const pageId = roam.pull("[:block/page]", [":block/uid", uid])?.[":block/page"]?.[":db/id"];
                    if (pageId) {
                        pageTitle = roam.pull("[:node/title]", pageId)?.[":node/title"] || "";
                        targetPageUid = roam.pull("[:block/uid]", pageId)?.[":block/uid"] || null;
                    }
                }
                if (!pageTitle) {
                    const openUid = await roam.ui.mainWindow.getOpenPageOrBlockUid();
                    if (openUid) {
                        const openNode = roam.pull("[:node/title :block/page]", [":block/uid", openUid]);
                        if (openNode?.[":node/title"]) {
                            pageTitle = openNode[":node/title"];
                            targetPageUid = openUid;
                        } else {
                            const openPageId = openNode?.[":block/page"]?.[":db/id"];
                            if (openPageId) {
                                pageTitle = roam.pull("[:node/title]", openPageId)?.[":node/title"] || "";
                                targetPageUid = roam.pull("[:block/uid]", openPageId)?.[":block/uid"] || null;
                            }
                        }
                    }
                }
            } catch (e) {
                sendErrorAlert("Could not read the current Roam page.");
                return [];
            }
            if (!pageTitle) {
                sendErrorAlert("Could not determine the current page title.");
                return [];
            }

            const searchTerm = encodeURIComponent(pageTitle);
            const searchUrl = "https://www.omdbapi.com/?apiKey=" + apiKey + "&s=" + searchTerm;
            const titleUrl = "https://www.omdbapi.com/?apiKey=" + apiKey + "&t=" + searchTerm;

            let movieId = null;
            try {
                const movies = await fetchJson(searchUrl);
                if (movies?.Response === "False" || !Array.isArray(movies?.Search)) {
                    const data = await fetchJson(titleUrl);
                    movieId = data?.imdbID || null;
                } else {
                    const options = movies.Search
                        .filter((m) => m.Type === "movie" || m.Type === "series")
                        .map((m) => ({ label: m.Title + " (" + m.Year + ")", id: m.imdbID }));
                    options.push({ label: "None of these titles!", id: "1111" });

                    let selectString = "<select>";
                    for (let i = 0; i < options.length; i++) {
                        selectString += "<option value=\"" + escapeHtml(options[i].id) + "\">" + escapeHtml(options[i].label) + "</option>";
                    }
                    selectString += "</select>";
                    movieId = await prompt("Which movie do you mean?", 2, selectString);
                }
            } catch (e) {
                sendErrorAlert("IMDb search failed. Please check your connection and API key.");
                return [];
            }

            if (movieId == "1111") {
                movieId = await prompt("What is the IMDb id?", 1);
            }
            if (!movieId || movieId == "null") {
                return [{ text: "No movie selected!" }];
            }

            try {
                const url = "https://www.omdbapi.com/?apiKey=" + apiKey + "&i=" + movieId + "&plot=full";
                const movies = await fetchJson(url);
                if (!movies || movies.Response === "False") {
                    return [{ text: "No movie selected!" }];
                }
                if (extensionAPI.settings.get("imdb-rewrite-page-title") === true) {
                    // Safety guard: only allow title rewrites for page-level imports.
                    const isPageLevelImport = !uid;
                    if (isPageLevelImport) {
                        try {
                            await maybeRenamePageTitle(roam, targetPageUid, movies.Title);
                        } catch (e) {
                            sendErrorAlert("Could not rewrite the Roam page title.");
                        }
                    } else {
                        sendInfoAlert("Page title rewrite only applies when importing from a page.");
                    }
                }

                const cleanWriterSegment = (segment) =>
                    segment
                        .replace(new RegExp("(based on a story by)|(additional story material)|(screen play)|(by)|(novel)|(characters)|(story by)|(screenplay by)|(based on characters created by)|(based upon the novel by)|(story)|(screenplay)|(co-head)", "gi"), "")
                        .replace(new RegExp("\\[(.+)\\]", "g"), "");
                const toLinkedList = (value, segmentCleaner = null) =>
                    String(value || "")
                        .split(",")
                        .map((segment) => (segmentCleaner ? segmentCleaner(segment) : segment))
                        .map((segment) => sanitiseRoamInline(segment))
                        .filter(Boolean)
                        .join("]] [[");
                const toHashList = (value) =>
                    String(value || "")
                        .split(",")
                        .map((segment) => sanitiseRoamInline(segment).replace(/\s+/g, "-"))
                        .filter(Boolean)
                        .join(" #");

                const directors = toLinkedList(movies.Director);
                const writers = toLinkedList(movies.Writer, cleanWriterSegment);
                const cast = toLinkedList(movies.Actors);
                const genre = toHashList(movies.Genre);
                const plot = sanitiseRoamPlainText(movies.Plot);
                const year = sanitiseRoamInline(movies.Year);

                let imdbRating = undefined;
                let rtRating = undefined;
                let mcRating = undefined;
                if (Array.isArray(movies.Ratings)) {
                    for (let i = 0; i < movies.Ratings.length; i++) {
                        if (movies.Ratings[i].Source == "Internet Movie Database") {
                            imdbRating = movies.Ratings[i].Value.toString().replace("/10", "");
                        } else if (movies.Ratings[i].Source == "Rotten Tomatoes") {
                            rtRating = movies.Ratings[i].Value.toString().replace("%", "");
                        } else if (movies.Ratings[i].Source == "Metacritic") {
                            mcRating = movies.Ratings[i].Value.toString().replace("/100", "");
                        }
                    }
                }
                let ratings = "";
                if (imdbRating != undefined) {
                    ratings += "#imdbIcon ^^" + imdbRating + "^^";
                }
                if (rtRating != undefined) {
                    if (parseInt(rtRating, 10) < 60) {
                        ratings += "#rtIconRotten ^^" + rtRating + "%^^";
                    } else {
                        ratings += "#rtIconFresh ^^" + rtRating + "%^^";
                    }
                }
                if (mcRating != undefined) {
                    ratings += "  #mcIcon^^" + mcRating + "^^ ";
                }
                const children = [];
                const addMetadata = (label, value, asAttribute, wrapInLink = false) => {
                    if (!hasVisibleText(value)) return;
                    const separator = asAttribute ? ":: " : ": ";
                    const rendered = wrapInLink ? "[[" + value + "]]" : value;
                    children.push({ text: label + separator + rendered });
                };
                const asAttributes = extensionAPI.settings.get("imdb-attributes") == true;
                const orderedFields = [
                    {
                        label: imdbDirector,
                        value: directors,
                        wrapInLink: true,
                        order: getOutputFieldOrder(extensionAPI, "imdb-director-position", 1),
                        fallbackIndex: 1,
                    },
                    {
                        label: imdbWriter,
                        value: writers,
                        wrapInLink: true,
                        order: getOutputFieldOrder(extensionAPI, "imdb-writer-position", 2),
                        fallbackIndex: 2,
                    },
                    {
                        label: imdbCast,
                        value: cast,
                        wrapInLink: true,
                        order: getOutputFieldOrder(extensionAPI, "imdb-cast-position", 3),
                        fallbackIndex: 3,
                    },
                    {
                        label: imdbYear,
                        value: year,
                        wrapInLink: true,
                        order: getOutputFieldOrder(extensionAPI, "imdb-year-position", 4),
                        fallbackIndex: 4,
                    },
                    {
                        label: imdbGenre,
                        value: hasVisibleText(genre) ? "#" + genre : "",
                        wrapInLink: false,
                        order: getOutputFieldOrder(extensionAPI, "imdb-genre-position", 5),
                        fallbackIndex: 5,
                    },
                    {
                        label: imdbRatingString,
                        value: ratings,
                        wrapInLink: false,
                        order: getOutputFieldOrder(extensionAPI, "imdb-rating-position", 6),
                        fallbackIndex: 6,
                    },
                ];
                orderedFields
                    .sort((a, b) => {
                        if (a.order !== b.order) return a.order - b.order;
                        return a.fallbackIndex - b.fallbackIndex;
                    })
                    .forEach((field) => addMetadata(field.label, field.value, asAttributes, field.wrapInLink));

                const outputBlocks = [];
                if (String(movies.Poster || "").startsWith("http")) {
                    outputBlocks.push({ text: "![](" + String(movies.Poster || "") + ")  " });
                }
                if (children.length) {
                    outputBlocks.push({
                        text: "**Metadata:**",
                        children: children
                    });
                }
                if (hasVisibleText(movies.imdbID)) {
                    outputBlocks.push({
                        text: "**IMDb:** https://www.imdb.com/title/" + String(movies.imdbID || ""),
                    });
                }
                if (hasVisibleText(plot)) {
                    outputBlocks.push({ text: "**Plot Summary:** " + plot });
                }

                if (!outputBlocks.length) {
                    return [{ text: "No movie data available for this title." }];
                }

                return [
                    ...outputBlocks
                ];
            } catch (e) {
                sendErrorAlert("Could not load IMDb details for that title.");
                return [];
            }
        }
    },
    onunload: () => {
        isExtensionLoaded = false;
        isUnloading = true;
        isImportInFlight = false;
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
        }
        appendOrderCache.clear();
        window.roamAlphaAPI?.ui?.commandPalette?.removeCommand?.({
            label: COMMAND_LABEL
        });
        if (smartblocksLoadedHandler) {
            document.body.removeEventListener("roamjs:smartblocks:loaded", smartblocksLoadedHandler);
            smartblocksLoadedHandler = null;
        }
        if (window.roamjs?.extension?.smartblocks) {
            window.roamjs.extension.smartblocks.unregisterCommand(SMARTBLOCK_COMMAND);
        }
    }
}

function sendConfigAlert() {
    if (isUnloading) return;
    iziToast.show({
        theme: 'dark',
        message: 'Please set the API key in the configuration settings via the Roam Depot tab.',
        position: 'center',
        close: false,
        class: 'imdb',
        timeout: 3000,
        closeOnClick: true,
        displayMode: 2
    });
}

function sendErrorAlert(message) {
    if (isUnloading) return;
    iziToast.show({
        theme: "dark",
        message,
        position: "center",
        close: false,
        class: "imdb",
        timeout: 3500,
        closeOnClick: true,
        displayMode: 2
    });
}

function sendInfoAlert(message) {
    if (isUnloading) return;
    iziToast.show({
        theme: "dark",
        message,
        position: "center",
        close: false,
        class: "imdb",
        timeout: 2200,
        closeOnClick: true,
        displayMode: 2
    });
}

function confirmRenamePrompt(currentTitle, nextTitle) {
    return new Promise((resolve) => {
        let settled = false;
        const safeResolve = (value) => {
            if (settled) return;
            settled = true;
            resolve(value === true);
        };
        const fromTitle = hasVisibleText(currentTitle) ? currentTitle : "(Untitled)";
        const toTitle = hasVisibleText(nextTitle) ? nextTitle : "(Untitled)";
        iziToast.question({
            theme: "light",
            color: "black",
            layout: 2,
            drag: false,
            timeout: false,
            close: false,
            overlay: true,
            title: "IMDb",
            message: `Rewrite page title from "${escapeHtml(fromTitle)}" to "${escapeHtml(toTitle)}"?`,
            position: "center",
            buttons: [
                [
                    "<button><b>Rewrite</b></button>",
                    function (instance, toast) {
                        safeResolve(true);
                        instance.hide({ transitionOut: "fadeOut" }, toast, "button");
                    },
                    false,
                ],
                [
                    "<button>Keep current title</button>",
                    function (instance, toast) {
                        safeResolve(false);
                        instance.hide({ transitionOut: "fadeOut" }, toast, "button");
                    },
                ],
            ],
            onClosing: function () { safeResolve(false); },
            onClosed: function () { safeResolve(false); },
        });
    });
}

async function prompt(string, type, selectString) {
    if (type == 1) {
        return new Promise((resolve) => {
            let settled = false;
            const safeResolve = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            iziToast.question({
                theme: 'light',
                color: 'black',
                layout: 2,
                drag: false,
                timeout: false,
                close: false,
                overlay: true,
                displayMode: 2,
                id: "question",
                title: "IMDb",
                message: string,
                position: "center",
                inputs: [
                    [
                        '<input type="text" placeholder="">',
                        "keyup",
                        function (instance, toast, input, e) {
                            if (e.code === "Enter") {
                                safeResolve(e.srcElement.value);
                                instance.hide({ transitionOut: "fadeOut" }, toast, "button");
                            }
                        },
                        true,
                    ],
                ],
                buttons: [
                    [
                        "<button><b>Confirm</b></button>",
                        async function (instance, toast, button, e, inputs) {
                            safeResolve(inputs[0].value);
                            instance.hide({ transitionOut: "fadeOut" }, toast, "button");
                        },
                        false,
                    ],
                    [
                        "<button>Cancel</button>",
                        async function (instance, toast, button, e) {
                            safeResolve("null");
                            instance.hide({ transitionOut: "fadeOut" }, toast, "button");
                        },
                    ],
                ],
                onClosing: function () { safeResolve("null"); },
                onClosed: function () { safeResolve("null"); },
            });
        })
    } else if (type == 2) {
        return new Promise((resolve) => {
            let settled = false;
            const safeResolve = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            iziToast.question({
                theme: 'light',
                color: 'black',
                layout: 2,
                drag: false,
                timeout: false,
                close: false,
                overlay: true,
                title: "IMDb",
                message: string,
                position: 'center',
                inputs: [
                    [selectString, 'change', function (instance, toast, select, e) { }]
                ],
                buttons: [
                    ['<button><b>Confirm</b></button>', function (instance, toast, button, e, inputs) {
                        const inputValue = inputs?.[0]?.value;
                        const selectedOptionValue = inputs?.[0]?.options?.[inputs?.[0]?.selectedIndex]?.value;
                        const domSelectedValue = toast?.querySelector?.("select")?.value;
                        safeResolve(inputValue ?? selectedOptionValue ?? domSelectedValue ?? "null");
                        instance.hide({ transitionOut: 'fadeOut' }, toast, 'button');
                    }, false], // true to focus
                    [
                        "<button>Cancel</button>",
                        function (instance, toast, button, e) {
                            safeResolve("null");
                            instance.hide({ transitionOut: "fadeOut" }, toast, "button");
                        },
                    ],
                ],
                onClosing: function () { safeResolve("null"); },
                onClosed: function () { safeResolve("null"); },
            });
        })
    }
}
