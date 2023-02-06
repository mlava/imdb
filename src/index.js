import iziToast from "izitoast";

// copied and adapted from https://github.com/dvargas92495/roamjs-components/blob/main/src/writes/createBlock.ts
const createBlock = (params) => {
    const uid = window.roamAlphaAPI.util.generateUID();
    return Promise.all([
        window.roamAlphaAPI.createBlock({
            location: {
                "parent-uid": params.parentUid,
                order: params.order,
            },
            block: {
                uid,
                string: params.node.text
            }
        })
    ].concat((params.node.children || []).map((node, order) =>
        createBlock({ parentUid: uid, order, node })
    )))
};

const config = {
    tabTitle: "IMDb import",
    settings: [
        {
            id: "imdb-apiKey",
            name: "OMDb API key",
            description: "Your API Key from http://www.omdbapi.com/apikey.aspx",
            action: { type: "input", placeholder: "Add OMDb API key here" },
        },
        {
            id: "imdb-director",
            name: "Director heading",
            description: "Preferred heading text for Director field",
            action: { type: "input", placeholder: "Director" },
        },
        {
            id: "imdb-writer",
            name: "Writer heading",
            description: "Preferred heading text for Writer field",
            action: { type: "input", placeholder: "Writer" },
        },
        {
            id: "imdb-cast",
            name: "Cast heading",
            description: "Preferred heading text for Cast field",
            action: { type: "input", placeholder: "Cast" },
        },
        {
            id: "imdb-year",
            name: "Release Year heading",
            description: "Preferred heading text for release year field",
            action: { type: "input", placeholder: "Year" },
        },
        {
            id: "imdb-genre",
            name: "Genre heading",
            description: "Preferred heading text for genre field",
            action: { type: "input", placeholder: "Genre" },
        },
        {
            id: "imdb-rating",
            name: "Ratings heading",
            description: "Preferred heading text for ratings field",
            action: { type: "input", placeholder: "Ratings" },
        },
        {
            id: "imdb-attributes",
            name: "Output as attributes",
            description: "Import each field using Roam atributes",
            action: { type: "switch" },
        },
    ]
};

export default {
    onload: ({ extensionAPI }) => {
        extensionAPI.settings.panel.create(config);

        window.roamAlphaAPI.ui.commandPalette.addCommand({
            label: "IMDb import",
            callback: () => {
                const uid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
                fetchIMDb(uid).then(async (blocks) => {
                    if (uid != undefined) {
                        const pageId = window.roamAlphaAPI.pull("[*]", [":block/uid", uid])?.[":block/page"]?.[":db/id"];
                        const parentUid = window.roamAlphaAPI.pull("[:block/uid]", pageId)?.[":block/uid"];
                        blocks.forEach((node, order) => createBlock({
                            parentUid,
                            order,
                            node
                        }));
                    } else {
                        const parentUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
                        blocks.forEach((node, order) => createBlock({
                            parentUid,
                            order,
                            node
                        }))
                    }
                });
            },
        });

        const args = {
            text: "IMDB",
            help: "Import film data from IMDb",
            handler: (context) => fetchIMDb,
        };

        if (window.roamjs?.extension?.smartblocks) {
            window.roamjs.extension.smartblocks.registerCommand(args);
        } else {
            document.body.addEventListener(
                `roamjs:smartblocks:loaded`,
                () =>
                    window.roamjs?.extension.smartblocks &&
                    window.roamjs.extension.smartblocks.registerCommand(args)
            );
        }

        async function fetchIMDb(uid) {
            var imdbDirector, imdbWriter, imdbCast, imdbYear, imdbGenre, imdbRatingString;
            breakme: {
                if (!extensionAPI.settings.get("imdb-apiKey")) {
                    sendConfigAlert();
                    break breakme;
                } else {
                    const apiKey = extensionAPI.settings.get("imdb-apiKey");
                    if (!extensionAPI.settings.get("imdb-director")) {
                        imdbDirector = "Director";
                    } else {
                        imdbDirector = extensionAPI.settings.get("imdb-director");
                    }
                    if (!extensionAPI.settings.get("imdb-writer")) {
                        imdbWriter = "Writer";
                    } else {
                        imdbWriter = extensionAPI.settings.get("imdb-writer");
                    }
                    if (!extensionAPI.settings.get("imdb-cast")) {
                        imdbCast = "Cast";
                    } else {
                        imdbCast = extensionAPI.settings.get("imdb-cast");
                    }
                    if (!extensionAPI.settings.get("imdb-year")) {
                        imdbYear = "Year";
                    } else {
                        imdbYear = extensionAPI.settings.get("imdb-year");
                    }
                    if (!extensionAPI.settings.get("imdb-genre")) {
                        imdbGenre = "Genre";
                    } else {
                        imdbGenre = extensionAPI.settings.get("imdb-genre");
                    }
                    if (!extensionAPI.settings.get("imdb-rating")) {
                        imdbRatingString = "Ratings";
                    } else {
                        imdbRatingString = extensionAPI.settings.get("imdb-rating");
                    }

                    const pageId = window.roamAlphaAPI.pull("[*]", [":block/uid", uid])?.[":block/page"]?.[":db/id"];
                    const pageTitle = pageId
                        ? window.roamAlphaAPI.pull("[:node/title]", pageId)?.[":node/title"]
                        : window.roamAlphaAPI.pull("[:node/title]", [
                            ":block/uid",
                            await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid()
                        ])?.[":node/title"];
                    const regex = /(\/)/g;
                    const subst = `%2F`;
                    const result = pageTitle.replace(regex, subst);
                    var url = "https://www.omdbapi.com/?apiKey=" + apiKey + "&s=" + result + "";
                    var url1 = "https://www.omdbapi.com/?apiKey=" + apiKey + "&t=" + result + "";

                    return fetch(url).then(r => r.json()).then(async (movies) => {
                        if (movies.Response == "False") {
                            return fetch(url1).then((response) => response.json()).then((data) => { return data.imdbID });
                        } else {
                            var options = movies.Search
                                .filter(m => m.Type === "movie" || m.Type === "series")
                                .map(m => ({ label: "" + m.Title + " (" + m.Year + ")", id: m.imdbID }));
                            options.push({ label: "None of these titles!", id: "1111" });

                            var selectString = "<select>";
                            if (options.length > 0) {
                                for (var i = 0; i < options.length; i++) {
                                    selectString += "<option value=\"" + options[i].id + "\">" + options[i].label + "</option>"
                                }
                            }
                            selectString += "</select>";
                            return prompt("Which movie do you mean?", 2, selectString);
                        }
                    }).then(async (movieId) => {
                        if (movieId == "1111") {
                            movieId = await prompt("What is the IMDb id?", 1);
                            if (movieId == "null") {
                                return [{ text: "No movie selected!" }];
                            }
                        }
                        var url = "https://www.omdbapi.com/?apiKey=" + apiKey + "&i=" + movieId + "&plot=full";
                        return !movieId ? [{ text: "No movie selected!" }] : fetch(url).then(r => r.json()).then((movies) => {
                            
                            const directors = movies.Director;
                            const writers = movies.Writer
                                .replace(new RegExp('(based on a story by)|(additional story material)|(screen play)|(by)|(novel)|(characters)|(story by)|(screenplay by)|(based on characters created by)|(based upon the novel by)|(story)|(screenplay)|(co-head)', 'g'), "")
                                .replace(new RegExp('\[(.+)\]', 'g'), "")
                                .replace(new RegExp(' , ', 'g'), "]] [[")
                                .replace(new RegExp(', ', 'g'), "]] [[");
                            const cast = movies.Actors.replace(new RegExp(', ', 'g'), "]] [[");
                            const genre = movies.Genre.replace(new RegExp(', ', 'g'), " #");

                            var imdbRating = undefined;
                            var rtRating = undefined;
                            var mcRating = undefined;
                            if (movies.hasOwnProperty("Ratings")) {
                                for (var i = 0; i < movies.Ratings.length; i++) {
                                    if (movies.Ratings[i].Source == "Internet Movie Database") {
                                        imdbRating = movies.Ratings[i].Value.toString();
                                        imdbRating = imdbRating.replace("/10", "");
                                    } else if (movies.Ratings[i].Source == "Rotten Tomatoes") {
                                        rtRating = movies.Ratings[i].Value.toString();
                                        rtRating = rtRating.replace("%", "");
                                    } else if (movies.Ratings[i].Source == "Metacritic") {
                                        mcRating = movies.Ratings[i].Value.toString();
                                        mcRating = mcRating.replace("/100", "");
                                    }
                                }
                            }
                            var ratings = "";
                            if (imdbRating != undefined) {
                                ratings += "#imdbIcon ^^" + imdbRating + "^^";
                            }
                            if (rtRating != undefined) {
                                if (parseInt(rtRating) < 60) {
                                    ratings += "#rtIconRotten ^^" + rtRating + "%^^";
                                } else {
                                    ratings += "#rtIconFresh ^^" + rtRating + "%^^";
                                }
                            }
                            if (mcRating != undefined) {
                                ratings += "  #mcIcon^^" + mcRating + "^^ ";
                            }
                            var children = [];
                            if (extensionAPI.settings.get("imdb-attributes") == true) {
                                children.push({ text: "" + imdbDirector + ":: [[" + directors + "]]" });
                                children.push({ text: "" + imdbWriter + ":: [[" + writers + "]]" });
                                children.push({ text: "" + imdbCast + ":: [[" + cast + "]]" });
                                children.push({ text: "" + imdbYear + ":: [[" + movies.Year + "]]" });
                                children.push({ text: "" + imdbGenre + ":: #" + genre + "" });
                                if (imdbRating != undefined || rtRating != undefined || mcRating != undefined) {
                                    children.push({ text: "" + imdbRatingString + ":: " + ratings + "" });
                                }
                            } else {
                                children.push({ text: "" + imdbDirector + ": [[" + directors + "]]" });
                                children.push({ text: "" + imdbWriter + ": [[" + writers + "]]" });
                                children.push({ text: "" + imdbCast + ": [[" + cast + "]]" });
                                children.push({ text: "" + imdbYear + ": [[" + movies.Year + "]]" });
                                children.push({ text: "" + imdbGenre + ": #" + genre + "" });
                                if (imdbRating != undefined || rtRating != undefined || mcRating != undefined) {
                                    children.push({ text: "" + imdbRatingString + ": " + ratings + "" });
                                }
                            }

                            return [
                                {
                                    text: "![](" + movies.Poster + ")  "
                                },
                                {
                                    text: "**Metadata:**",
                                    children: children
                                },
                                {
                                    text: "**IMDb:** https://www.imdb.com/title/" + movies.imdbID + "",
                                },
                                { text: "**Plot Summary:** " + movies.Plot + "" },
                            ];
                        })
                    })
                }
            }
        };
    },
    onunload: () => {
        window.roamAlphaAPI.ui.commandPalette.removeCommand({
            label: 'IMDb import'
        });
        if (window.roamjs?.extension?.smartblocks) {
            window.roamjs.extension.smartblocks.unregisterCommand("IMDB");
        };
    }
}

function sendConfigAlert() {
    alert("Please set the API key in the configuration settings via the Roam Depot tab.");
}

async function prompt(string, type, selectString) {
    if (type == 1) {
        return new Promise((resolve) => {
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
                                instance.hide({ transitionOut: "fadeOut" }, toast, "button");
                                resolve(e.srcElement.value);
                            }
                        },
                        true,
                    ],
                ],
                buttons: [
                    [
                        "<button><b>Confirm</b></button>",
                        async function (instance, toast, button, e, inputs) {
                            instance.hide({ transitionOut: "fadeOut" }, toast, "button");
                            resolve(inputs[0].value);
                        },
                        false,
                    ],
                    [
                        "<button>Cancel</button>",
                        async function (instance, toast, button, e) {
                            instance.hide({ transitionOut: "fadeOut" }, toast, "button");
                            resolve("null");
                        },
                    ],
                ],
                onClosing: function (instance, toast, closedBy) { },
                onClosed: function (instance, toast, closedBy) { },
            });
        })
    } else if (type == 2) {
        return new Promise((resolve) => {
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
                        instance.hide({ transitionOut: 'fadeOut' }, toast, 'button');
                        resolve(inputs[0].options[inputs[0].selectedIndex].value);
                    }, false], // true to focus
                    [
                        "<button>Cancel</button>",
                        function (instance, toast, button, e) {
                            instance.hide({ transitionOut: "fadeOut" }, toast, "button");
                        },
                    ],
                ]
            });
        })
    }
}