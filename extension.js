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

// copied and adapted from https://github.com/dvargas92495/roamjs-components/blob/main/src/components/FormDialog.tsx
const FormDialog = ({
    onSubmit,
    title,
    options,
    question,
    onClose,
}) => {
    const [data, setData] = window.React.useState(options[0].id);
    const onClick = window.React.useCallback(
        () => {
            onSubmit(data);
            onClose();
        },
        [data, onClose]
    );
    const onCancel = window.React.useCallback(
        () => {
            onSubmit("");
            onClose();
        },
        [onClose]
    )
    return window.React.createElement(
        window.Blueprint.Core.Dialog,
        { isOpen: true, onClose: onCancel, title, },
        window.React.createElement(
            "div",
            { className: window.Blueprint.Core.Classes.DIALOG_BODY },
            question,
            window.React.createElement(
                window.Blueprint.Core.Label,
                {},
                "Movies:",
                window.React.createElement(
                    window.Blueprint.Select.Select,
                    {
                        activeItem: data,
                        onItemSelect: (id) => setData(id),
                        items: options.map(opt => opt.id),
                        itemRenderer: (item, { modifiers, handleClick }) => window.React.createElement(
                            window.Blueprint.Core.MenuItem,
                            {
                                key: item,
                                text: options.find(opt => opt.id === item).label,
                                active: modifiers.active,
                                onClick: handleClick,
                            }
                        ),
                        filterable: false,
                        popoverProps: {
                            minimal: true,
                            captureDismiss: true,
                        }
                    },
                    window.React.createElement(
                        window.Blueprint.Core.Button,
                        {
                            text: options.find(opt => opt.id === data).label,
                            rightIcon: "double-caret-vertical"
                        }
                    )
                )
            )
        ),
        window.React.createElement(
            "div",
            { className: window.Blueprint.Core.Classes.DIALOG_FOOTER },
            window.React.createElement(
                "div",
                { className: window.Blueprint.Core.Classes.DIALOG_FOOTER_ACTIONS },
                window.React.createElement(
                    window.Blueprint.Core.Button,
                    { text: "Cancel", onClick: onCancel, }
                ),
                window.React.createElement(
                    window.Blueprint.Core.Button,
                    { text: "Submit", intent: "primary", onClick }
                )
            )
        )
    );
}

const prompt = ({
    options,
    question,
    title,
}) =>
    new Promise((resolve) => {
        const app = document.getElementById("app");
        const parent = document.createElement("div");
        parent.id = 'imdb-prompt-root';
        app.parentElement.appendChild(parent);

        window.ReactDOM.render(
            window.React.createElement(
                FormDialog,
                {
                    onSubmit: resolve,
                    title,
                    options,
                    question,
                    onClose: () => {
                        window.ReactDOM.unmountComponentAtNode(parent);
                        parent.remove();
                    }
                }
            ),
            parent
        )
    });

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
            callback: () => {
                const uid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
                fetchIMDb(uid).then(async (blocks) => {
                    const parentUid = uid || await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
                    blocks.forEach((node, order) => createBlock({
                        parentUid,
                        order,
                        node
                    }))
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
            breakme: {
                if (!extensionAPI.settings.get("imdb-apiKey")) {
                    sendConfigAlert();
                    break breakme;
                } else {
                    const apiKey = extensionAPI.settings.get("imdb-apiKey");
                    const pageId = window.roamAlphaAPI.pull("[*]", [":block/uid", uid])?.[":block/page"]?.[":db/id"];
                    const pageTitle = pageId
                        ? window.roamAlphaAPI.pull("[:node/title]", pageId)?.[":node/title"]
                        : window.roamAlphaAPI.pull("[:node/title]", [
                            ":block/uid",
                            await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid()
                        ])?.[":node/title"];
                    var url = "https://www.omdbapi.com/?apiKey=" + apiKey + "&s=" + pageTitle + "";

                    return fetch(url).then(r => r.json()).then((movies) => {
                        const options = movies.Search
                            .filter(m => m.Type === "movie" || m.Type === "series")
                            .map(m => ({ label: "" + m.Title + " (" + m.Year + ")", id: m.imdbID }));
                        return prompt({
                            title: "IMDB",
                            question: "Which movie do you mean?",
                            options,
                        })
                    }).then((movieId) => {
                        var url = "https://www.omdbapi.com/?apiKey=" + apiKey + "&i=" + movieId + "";
                        return !movieId ? [{ text: "No movie selected!" }] : fetch(url).then(r => r.json()).then((movies) => {
                            const directors = movies.Director;
                            const writers = movies.Writer
                                .replace(new RegExp('(based on a story by)|(additional story material)|(screen play)|(by)|(novel)|(characters)|(story by)|(screenplay by)|(based on characters created by)|(based upon the novel by)|(story)|(screenplay)|(co-head)', 'g'), "")
                                .replace(new RegExp('\[(.+)\]', 'g'), "")
                                .replace(new RegExp(' , ', 'g'), "]] [[")
                                .replace(new RegExp(', ', 'g'), "]] [[");
                            const cast = movies.Actors.replace(new RegExp(', ', 'g'), "]] [[");
                            const genre = movies.Genre.replace(new RegExp(', ', 'g'), " #");

                            return [
                                {
                                    text: "![](" + movies.Poster + ")  "
                                },
                                {
                                    text: "**Metadata:**",
                                    children: [
                                        { text: "**Director:** [[" + directors + "]]" },
                                        { text: "**Writer:** [[" + writers + "]]" },
                                        { text: "**Cast:** [[" + cast + "]]" },
                                        { text: "**Year:** [[" + movies.Year + "]]" },
                                        { text: "**Keywords:** #" + genre + "" },
                                    ]
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