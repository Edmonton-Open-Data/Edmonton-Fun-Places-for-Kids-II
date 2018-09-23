const log = console.log;

//names for csv files (courtesy of Edmonton Open Data)
const dataFiles = [
    "Attractions(Sep-17-2018)",
    "Ball_Diamonds(Sep-17-2018)",
    "Community_Drop-in_Program_-_Summer_2018(Sep-17-2018)",
    "Cricket_Fields(Sep-17-2018)",
    "Playgrounds(September-17-2018)",
    "Public_Libraries(Sep-17-2018)",
    "Soccer_Fields(Sep-17-2018)",
    "Track_Sports_Fields(Sep-17-2018)"
];

//for loading csv files
const PromiseWrapper = function(d) {
    return new Promise(function(resolve) {
        d3.csv(d, function(p) { resolve(p); });
    });
};

//iteratively load csv files from myData folder
const promises = dataFiles.map(file => PromiseWrapper(`myData/${file}.csv`));

//to load icons from myImg folder
const loader = new PIXI.loaders.Loader();

//for displaying name and type of marker 
const legend = document.querySelector("div.legend.geometry");
let legendContent = legend.querySelector(".content");

//Leaflet and map setup
const map = L.map("map", {
    zoomSnap: 0.5,
    zoom: zoomSelector(window.innerWidth),
    minZoom: 10.06,
    maxZoom: 18
});
const positron = L.tileLayer("https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="http://cartodb.com/attributions">CartoDB</a>',
    maxZoom: 18
});

map.setView([53.489883960188344, -113.51966857910158]);
map.attributionControl.setPosition('bottomleft');
map.zoomControl.setPosition('bottomright');
map.on("resize", function() {
    map.setZoom(zoomSelector(window.innerWidth))
        .getBounds().getCenter();
});
L.control.scale().setPosition("bottomleft").addTo(map); 
positron.addTo(map);

//promises resolved then passed to funViz call back
Promise.all(promises).then((resolve) => funViz(resolve));

//select zoom based on window innerWidth
function zoomSelector(size) {
    return size < 768   ? 10.06:
           size >= 768 && size != 1024 && size <= 1366 ? 10.71:
           11;
};

//Places points on the map and creates htmlLegend(legend and totals)
function funViz(allData) {
    //reduces all data into one array 
    //empty types and names handled as well (data cleaning)
    const allDataReduced = allData.reduce((acc, curVal) => acc.concat(curVal), []);
    allDataReduced.forEach(d => {
        if(d["TYPE"] == "") d["TYPE"] = "No Type";
        if(d["NAME"] == "") d["NAME"] = "No Name";
    });

    //nested points by types
    const dataNest = d3.nest().key(d => d["TYPE"]).entries(allDataReduced);
    const allTypes = dataNest.map(d => d.key);
    const colorScale = d3.scaleOrdinal()
            .domain(allTypes)
            .range([
                "0xFF420E", "0xD0E1F9", "0xE6D72A", "0xF18D9E", "0x4CB5F5", "0xF1F1F2", 
                "0x89DA59", "0xFA812F","0xFFA577", "0xDDC5A2", "0xB9C4C9", "0xB8D20B", 
                "0xF9BA32", "0x00CFFA", "0xE5E2CA", "0xFA6775","0x92AAC7", "0xDBAE58" 
            ]);

    //build htmlLegend based on dataNest (data driven)		
    const inputDivs = dataNest.map(d => {
        const layerName = d.key;
        const totalPoints = d.values.length;

        return inputMarker(layerName, totalPoints);
        
    }).reduce((acc, curVal) => acc + curVal, "");
    const formInputHTML = `<form>${inputDivs}</form>`;

    //helper leaflet plugin - htmlLegend
    const htmlLegend = L.control.htmllegend({
        position: "topright",
        legends: [{
            name: "Legend",
            elements: [{
                html: formInputHTML,
                label: "Toggle Types"
                
            }]
        }],
        collapseSimple: true,
        detectStretched: true
    });

    //iteratively load icons from myImg folder
    allTypes.forEach(d => loader.add(d, `myImg/${d}.png`));

    //add htmlLegend to map and close it (default setting is opened)
    map.addControl(htmlLegend);
    d3.select("div h4").classed("closed", true);

    //for building htmlLegend checkbox inputs
    function inputMarker(name, points) {
        const inputDiv = `
                <div>
                    <span style="background-color: #${colorScale(name).substring(2)};" class="tbl-cell span-rect">
                        <input type="checkbox" id="${name}" name="layers" checked="checked">
                    </span>
                    <span class="tbl-cell input-label">
                        <strong>${name} - ${points}</strong>
                    </span>
                <div/>`;

        return inputDiv;
    };

    loader.load(function(loader, resources) {
        //preparation of markers and layer containers
        //individual layer containers, facilate toggling layers on or off
        const layerData = dataNest.map(d => {
            const key = d.key;
            const values = d.values;
            const layerContainer = new PIXI.Container();

            layerContainer.interactive = true;
            layerContainer.buttonMode = true;
            layerContainer.interactiveChildren = true;
            layerContainer.name = key;
            
            //markers are nested in layer container
            const layerMarkers = values.map(p => {
                const markerSprite = new PIXI.Sprite(resources[key]["texture"]);

                markerSprite.legend = `${p["NAME"]} - ${key}`;
                markerSprite.tint = colorScale(key);
                markerSprite.interactive = true;
                markerSprite.buttonMode = true;
                markerSprite.anchor.set(0.5, 0.5);
                layerContainer.addChild(markerSprite);

                return {
                    "LATITUDE": p["LATITUDE"],
                    "LONGITUDE": p["LONGITUDE"],
                    "MARKERSPRITE": markerSprite
                };
            });

            //layer container - to add to parent container
            //markers - to assign coordinates and scale for pixiLayer
            return {
                "layerContainer": layerContainer,
                "layerMarkers": layerMarkers
            };

        });
        
        
        //parent container - to nest layer containers
        //ticker for spining animation
        const parentContainer = new PIXI.Container();
        const ticker = new PIXI.ticker.Ticker();

        parentContainer.interactive = true;
        parentContainer.buttonMode = true;
        parentContainer.interactiveChildren = true;

        const pixiLayer = (function() {
            let previousZoom = null;
            let markerSprites = [];
            const doubleBuffering = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

            return L.pixiOverlay(function(utils, event) {
                const zoom = utils.getMap().getZoom();
                const stage = utils.getContainer();
                const renderer = utils.getRenderer();
                const project = utils.latLngToLayerPoint;
                const scale = utils.getScale();
                const invScale = (1 / scale) * 0.55;

                //get all the markers nested in layer conatiners 
                const allMarkers = layerData.map(d => d.layerMarkers)
                    .reduce((acc, curVal) => acc.concat(curVal),[]);
                
                if(event.type === "add") {
                    allMarkers.forEach(function(marker) {
                        const coords = project([marker["LATITUDE"], marker["LONGITUDE"]]);
                        let markerSprite = marker["MARKERSPRITE"];

                        markerSprite.x = coords.x;
                        markerSprite.y = coords.y;
                        markerSprite.scale.set(invScale);
                        markerSprites.push(markerSprite);
                    });

                    //iteratively add layer containers to parent container
                    layerData.forEach(d => stage.addChild(d.layerContainer));

                    /*
                    efficiency - listener only on the parent container as 
                    opposed, to adding listerners to each marker
                    */
                   stage.on("pointermove", e => {
                        const target = e.target;

                        if(target && target.legend) {
                            L.DomUtil.removeClass(legend, 'hide');
                            legendContent.innerHTML = target.legend;
                        }
                        else {
                            L.DomUtil.addClass(legend, 'hide');
                        };
                    });                    
                };

                if(event.type === "moveend" && previousZoom !== zoom) {
                    markerSprites.forEach(markerSprite => markerSprite.scale.set(invScale));

                    previousZoom = zoom;
                };

                if(event.type === "redraw") {
                    const delta  = event.delta;
                    
                    markerSprites.forEach(markerSprite => markerSprite.rotation += 0.03 * delta);
                };

                renderer.render(stage);

                /*
                use the input checked status and id to toggle the layers
                the input check boxes are initially checked to allow for logical toggling
                    (checked box -->container visible while unchecked box-->container invisible)
                rendering needs to be done in order to see the changes
                */
                d3.selectAll("input").on("click", function () { 
                    const inputStatus = d3.select(this).node().checked;
                    const inputid = d3.select(this).node().id;
                    
                    stage.children.forEach((container, i) => {
                        if(inputStatus == false && inputid == container.name) {
                            stage.children[i].visible = inputStatus;
                            renderer.render(stage);
                        };
                        if(inputStatus == true && inputid == container.name) {
                            stage.children[i].visible = inputStatus;
                            renderer.render(stage);
                        };
                    });
                });

            }, parentContainer, { doubleBuffering: doubleBuffering });
        })();

        ticker.add(delta => pixiLayer.redraw({type: "redraw", delta: delta}));
        ticker.start();

        pixiLayer.addTo(map);
        
    });
};