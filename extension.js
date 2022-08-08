const config = {
    tabTitle: "IMDb import",
    settings: [
        {
            id: "imdb-apiKey",
            name: "OMDb API key",
            description: "Your API Key from http://www.omdbapi.com/apikey.aspx",
            action: { type: "input", placeholder: "Add OMDb API key here" },
        },
    ]
};

export default {
    onload: ({ extensionAPI }) => {
        extensionAPI.settings.panel.create(config);

        window.roamAlphaAPI.ui.commandPalette.addCommand({
            label: "IMDb import",
            callback: () => fetchIMDb().then(string =>
                window.roamAlphaAPI.updateBlock({
                    block: {
                        uid: window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"],
                        string: string,
                    }
                })
            ),
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

        async function fetchIMDb() {
            const apiKey = extensionAPI.settings.get("imdb-apiKey");
            const startBlock = await window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];

            if (typeof buttonTrigger == 'undefined' || buttonTrigger == "false") {
                console.error("SB trigger - provide list of options");

                var blockUIDList = ['' + startBlock + ''];
                var rule = '[[(ancestor ?b ?a)[?a :block/children ?b]][(ancestor ?b ?a)[?parent :block/children ?b ](ancestor ?parent ?a) ]]';
                var query = `[:find  (pull ?block [:block/uid :block/string])(pull ?page [:node/title :block/uid])
                                                   :in $ [?block_uid_list ...] %
                                                   :where
                                                    [?block :block/uid ?block_uid_list]
                                                   [?page :node/title]
                                                   (ancestor ?block ?page)]`;
                var results = await window.roamAlphaAPI.q(query, blockUIDList, rule);
                var pageTitle = results[0][1].title;

                var settings = {
                    "url": "https://www.omdbapi.com/?apiKey=" + apiKey + "&s=" + pageTitle + "",
                    "method": "GET",
                    "async": false,
                };

                $.ajax(settings).done(async function (response) {
                    var jsonMovies = JSON.stringify(response);
                    var movies = JSON.parse(jsonMovies);

                    var listToReturn = "Which movie did you mean? ";
                    for (var i = 0; i < 5; i++) {
                        if (typeof movies.Search[i] != 'undefined') {
                            if (movies.Search[i].Type == "movie" || movies.Search[i].Type == "series") {
                                var title = movies.Search[i].Title;
                                if (title.match(":")) {
                                    title = title.replaceAll(":", "");
                                }
                                if (title.match("'")) {
                                    title = title.replaceAll("'", "");
                                }
                                listToReturn += "{{" + title + " - " + movies.Search[i].Year + ":SmartBlock:IMDb Import:movieId=" + movies.Search[i].imdbID + ",startBlock=" + startBlock + ",buttonTrigger=true}} ";
                            }
                        }
                    }
                    await window.roamAlphaAPI.updateBlock({
                        block: {
                            uid: startBlock,
                            string: listToReturn,
                        }
                    })
                });
            } else if (buttonTrigger == "true") {
                console.error("Button trigger - straight to movie output");
                var settings = {
                    "url": "https://www.omdbapi.com/?apiKey=" + apiKey + "&i=" + movieId + "",
                    "method": "GET",
                    "async": false,
                };

                $.ajax(settings).done(function (response) {
                    //console.log(response);
                    var jsonMovies = JSON.stringify(response);
                    displayResults(jsonMovies, startBlock);
                });

                async function displayResults(jsonMovies, startBlock) {
                    //console.log("IMDb SmartBlock: "+jsonMovies);
                    var movies = JSON.parse(jsonMovies);
                    var directors = movies.Director;
                    var directors1 = directors.replace(new RegExp(', ', 'g'), "]] [[");
                    var writers = movies.Writer;
                    var res = writers.match(/screen|novel|story|characters|based/); // remove 'screen play' and 'novel' etc
                    if (res !== null) {
                        var writers = writers.replace(new RegExp('(based on a story by)|(additional story material)|(screen play)|(by)|(novel)|(characters)|(story by)|(screenplay by)|(based on characters created by)|(based upon the novel by)|(story)|(screenplay)|(co-head)', 'g'), "");
                        var writers = writers.replace(new RegExp('\[(.+)\]', 'g'), "");
                        var writers = writers.replace(new RegExp(' , ', 'g'), "]] [[");
                        var writers = writers.replace(new RegExp(', ', 'g'), "]] [[");
                    } else {
                        var writers = writers.replace(new RegExp(', ', 'g'), "]] [[");
                    }
                    var actors = movies.Actors;
                    var cast = actors.replace(new RegExp(', ', 'g'), "]] [[");
                    var genres = movies.Genre;
                    var genre = genres.replace(new RegExp(', ', 'g'), " #");

                    await roam42.common.updateBlock(newBlock, "![](" + movies.Poster + ")  ", true);
                    let headerUid = await roam42.common.createSiblingBlock(newBlock, "**Metadata:**", true);
                    let dUid = await roam42.common.createBlock(headerUid, 1, "**Director:** [[" + directors + "]]");
                    let wUid = await roam42.common.createSiblingBlock(dUid, "**Writer:** [[" + writers + "]]", true);
                    let cUid = await roam42.common.createSiblingBlock(wUid, "**Cast:** [[" + cast + "]]", true);
                    let yUid = await roam42.common.createSiblingBlock(cUid, "**Year:** [[" + movies.Year + "]]", true);
                    await roam42.common.createSiblingBlock(yUid, "**Keywords:** #" + genre + "", true);
                    let lUid = await roam42.common.createSiblingBlock(headerUid, "**IMDb:** https://www.imdb.com/title/" + movies.imdbID + "", true);
                    let pUid = await roam42.common.createSiblingBlock(lUid, "**Plot Summary:** " + movies.Plot + "", true);
                }
            }
            /*

            return new Promise((resolve) => $.ajax(settings).done(async function (response) {
                var jsonUnsplash = JSON.stringify(response);
                var imdb = JSON.parse(jsonUnsplash);
                var string = "![](" + imdb.urls.regular + ")\n'" + query + "' Image by [[" + imdb.user.name + "]] at [Unsplash](" + imdb.user.links.html + ")";
                resolve(string);
            }));
            */
        };
    },
    onunload: () => {
        window.roamAlphaAPI.ui.commandPalette.removeCommand({
            label: 'IMDb import'
        });
    }
}