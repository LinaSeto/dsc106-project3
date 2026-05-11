import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3/+esm';

// ---------- Constants ----------
const WIDTH = 600;
const HEIGHT = 350;
const DATA_DIR = 'docs/cmip6_json/';

// ---------- State ----------
const state = {
    feature: 'tas',
    left: { ssp: 'ssp126' },
    right: { ssp: 'ssp585' },
    yearLeft: 2015,
    yearRight: 2100,
    yearsLocked: true,
    clickedPoint: null,
};

const FEATURE_CONFIG = {
    tas: { interpolator: t => d3.interpolateRdBu(1 - t), label: 'Surface Air Temp', diverging: true },
    lai: { interpolator: d3.interpolateYlGn, label: 'Vegetation Area' },
    zos: { interpolator: d3.interpolateBlues, label: 'Sea Level', diverging: true },
    fire: { interpolator: d3.interpolateYlOrRd, label: 'Fire Index', landOnly: true },
    drought: { interpolator: d3.interpolateYlOrBr, label: 'Drought Index', landOnly: true },
};

const SSP_INFO = {
    ssp126: {
        label: 'SSP1-2.6 — Sustainable',
        description: 'An optimistic scenario where strong global cooperation cuts emissions by the second half of the century. Warming of ~1.8°C by 2100.',
    },
    ssp245: {
        label: 'SSP2-4.5 — Middle of the Road',
        description: 'Historical patterns continue and meet moderate climate policy, leading to a warming of ~2.7°C by 2100.',
    },
    ssp370: {
        label: 'SSP3-7.0 — Regional Rivalry',
        description: 'Reduced cooperation lead to rising emissions, doubling present levels by 2100, leading to a warming ~3.6°C by 2100.',
    },
    ssp585: {
        label: 'SSP5-8.5 — Fossil-Fueled',
        description: 'A highly pessimistic scenario involving rapid fossil-fueled growth. Emissions double by 2050, warming ~4.4°C by 2100.',
    },
};


const PROJECTION = d3.geoEquirectangular()
    .fitSize([WIDTH, HEIGHT], { type: 'Sphere' });

// ---------- Module-level caches ----------
let manifest;
let world;
let land;
const datasets = new Map();      // "feature_ssp" -> dataset
const yearIndexes = new Map();   // "feature_ssp" -> Map(year -> index)

// ---------- helper for tooltip ----------
function findNearestCell(cells, lat, lon) {
    const targetLon = lon < 0 ? lon + 360 : lon;
    let best = null;
    let bestDist = Infinity;
    for (const cell of cells) {
        const dlat = cell.lat - lat;
        const dlon = cell.lon - targetLon;
        const d = dlat * dlat + dlon * dlon;
        if (d < bestDist) { bestDist = d; best = cell; }
    }
    return best;
}

// ---------- animated year and lock ----------
let playTimer = null;
const YEAR_MIN = 2015;
const YEAR_MAX = 2100;
const PLAY_INTERVAL_MS = 200;   // tweak for faster/slower playback

function startPlay() {
    if (playTimer) return;

    if (state.yearLeft >= YEAR_MAX && state.yearRight >= YEAR_MAX) {
        state.yearLeft = YEAR_MIN;
        state.yearRight = YEAR_MIN;
    }

    state.playing = true;
    d3.select('#play-button').text('⏸').classed('active', true);

    playTimer = setInterval(() => {
        if (state.yearsLocked) {
            if (state.yearLeft < YEAR_MAX) {
                state.yearLeft++;
                state.yearRight = state.yearLeft;
            } else {
                stopPlay();
                return;
            }
        } else {
            let advanced = false;
            if (state.yearLeft < YEAR_MAX) { state.yearLeft++; advanced = true; }
            if (state.yearRight < YEAR_MAX) { state.yearRight++; advanced = true; }
            if (!advanced) {
                stopPlay();
                return;
            }
        }

        // Update slider thumbs
        d3.select('input.year-slider[data-side="left"]').property('value', state.yearLeft);
        d3.select('input.year-slider[data-side="right"]').property('value', state.yearRight);

        // Direct render — the 200ms interval is already slower than rAF, no need for scheduling
        render();
    }, PLAY_INTERVAL_MS);
}

function stopPlay() {
    if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
    }
    state.playing = false;
    d3.select('#play-button').text('▶').classed('active', false);
}

// ---------- Set up buttons ----------
function setupControls() {
    // feature buttons
    d3.selectAll('input[name="feature"]')
        .property('checked', function () { return this.value === state.feature; })
        .on('change', async function () {
            state.feature = this.value;
            await render();
        });

    // SSP dropdowns
    d3.selectAll('select.ssp-select').each(function () {
        const sel = d3.select(this);
        const side = this.dataset.side;   // "left" or "right"

        // Populate options from SSP_INFO
        sel.selectAll('option')
            .data(Object.entries(SSP_INFO))
            .join('option')
            .attr('value', ([key]) => key)
            .attr('title', ([, info]) => info.description)  // native hover tooltip
            .text(([, info]) => info.label)
            .property('selected', ([key]) => key === state[side].ssp);

        // Handle change
        sel.on('change', async function () {
            state[side].ssp = this.value;
            await render();
        });
    });

    // Year sliders
    d3.selectAll('input.year-slider').each(function () {
        // Initialize position from state
        const side = this.dataset.side;
        this.value = side === 'left' ? state.yearLeft : state.yearRight;
    });

    d3.selectAll('input.year-slider').on('input', function () {
        const side = this.dataset.side;
        const newYear = +this.value;  // unary + converts string to number

        if (state.yearsLocked) {
            state.yearLeft = newYear;
            state.yearRight = newYear;
            // Sync the other slider's thumb to match
            d3.selectAll('input.year-slider').property('value', newYear);
        } else {
            if (side === 'left') state.yearLeft = newYear;
            if (side === 'right') state.yearRight = newYear;
        }

        render();
    });

    // Play button toggle
    d3.select('#play-button').on('click', () => {
        state.playing ? stopPlay() : startPlay();
    });

    // Lock toggle
    d3.select('#lock-button').on('click', function () {
        state.yearsLocked = !state.yearsLocked;
        d3.select(this)
            .text(state.yearsLocked ? '🔒' : '🔓')
            .classed('active', state.yearsLocked);
    });

    // Set initial lock button visual to match state
    d3.select('#lock-button')
        .text(state.yearsLocked ? '🔒' : '🔓')
        .classed('active', state.yearsLocked);
}

// ---------- set up zoom feature ----------
function setupZoom() {
    let pendingTransform = null;
    let pendingSourceSvg = null;
    let scheduled = false;

    const zoom = d3.zoom()
        .scaleExtent([1, 10])
        .translateExtent([[0, 0], [WIDTH, HEIGHT]])
        .on('zoom', ({ transform, sourceEvent }) => {
            pendingTransform = transform;
            if (sourceEvent) pendingSourceSvg = sourceEvent.currentTarget;

            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                d3.selectAll('g.zoomable')
                    .style('transform',
                        `translate(${pendingTransform.x}px, ${pendingTransform.y}px) scale(${pendingTransform.k})`);

                if (state.clickedPoint) {
                    const [px, py] = PROJECTION([state.clickedPoint.lon, state.clickedPoint.lat]);
                    d3.selectAll('svg.marker-svg circle.marker')
                        .attr('cx', pendingTransform.applyX(px))
                        .attr('cy', pendingTransform.applyY(py));
                }

                if (pendingSourceSvg) {
                    const src = pendingSourceSvg;
                    pendingSourceSvg = null;
                    d3.selectAll('svg.main-svg').each(function () {
                        if (this !== src) d3.select(this).call(zoom.transform, pendingTransform);
                    });
                }
            });
        });

    d3.selectAll('svg.main-svg').call(zoom);
}

// ---------- Init ----------
async function init() {
    [manifest, world] = await Promise.all([
        d3.json(DATA_DIR + 'manifest.json'),
        d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'),
    ]);
    land = topojson.merge(world, world.objects.countries.geometries);

    await render();
    setupControls();
    setupZoom();
}

// ---------- Lazy data loading ----------
async function ensureDataset(feature, ssp) {
    const key = `${feature}_${ssp}`;
    if (!datasets.has(key)) {
        const path = manifest.variables[feature].files[ssp].path;
        const data = await d3.json(DATA_DIR + path);
        datasets.set(key, data);
        yearIndexes.set(key, new Map(data.years.map((y, i) => [y, i])));
        console.log(`Loaded ${key}: ${data.cells.length} cells`);
    }
    return datasets.get(key);
}

// ---------- Draw legend ----------
function drawLegend(color, label, unit, diverging) {
    const container = d3.select('#legend');
    container.selectAll('*').remove();

    const W = 20, H = 260;
    const margin = { top: 30, right: 45, bottom: 20, left: 10 };

    const svg = container.append('svg')
        .attr('viewBox',
            `0 0 ${W + margin.left + margin.right} ${H + margin.top + margin.bottom}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    // Title at the top
    svg.append('text')
        .attr('x', margin.left)
        .attr('y', 18)
        .attr('font-size', 12)
        .attr('font-weight', 'bold')
        .text(`${unit}`);

    const g = svg.append('g')
        .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Domain min/max — diverging scales store 3 values
    const domain = color.domain();
    const [vmin, vmax] = diverging ? [domain[0], domain[2]] : domain;

    // Build a gradient with many stops so it looks smooth
    const gradId = `grad-${Math.random().toString(36).slice(2, 9)}`;
    const grad = svg.append('defs').append('linearGradient')
        .attr('id', gradId)
        .attr('x1', '0%').attr('y1', '100%')   // bottom of bar = min
        .attr('x2', '0%').attr('y2', '0%');    // top of bar    = max

    const N = 20;
    for (let i = 0; i <= N; i++) {
        const t = i / N;
        const v = vmin + t * (vmax - vmin);
        grad.append('stop')
            .attr('offset', `${t * 100}%`)
            .attr('stop-color', color(v));
    }

    // The gradient bar
    g.append('rect')
        .attr('width', W)
        .attr('height', H)
        .attr('fill', `url(#${gradId})`)
        .attr('stroke', '#888')
        .attr('stroke-width', 0.5);

    // Axis to the right of the bar
    const yScale = d3.scaleLinear()
        .domain([vmax, vmin])     // inverted: top = max
        .range([0, H]);

    g.append('g')
        .attr('transform', `translate(${W}, 0)`)
        .call(d3.axisRight(yScale).ticks(6).tickSize(4))
        .call(sel => sel.select('.domain').remove())  // drop the axis spine
        .selectAll('text').attr('font-size', 10);
}

// ---------- cache color scale ----------
const colorScaleCache = new Map();

function getColorScale(feature, leftData, rightData) {
    const key = `${feature}_${leftData.ssp}_${rightData.ssp}`;
    if (colorScaleCache.has(key)) return colorScaleCache.get(key);

    const config = FEATURE_CONFIG[feature];
    const allValues = [
        ...leftData.cells.flatMap(c => c.v),
        ...rightData.cells.flatMap(c => c.v),
    ];
    const cleanValues = allValues.filter(v => v != null && !isNaN(v))
        .sort(d3.ascending);
    const vmin = d3.quantile(cleanValues, 0.02);
    const vmax = d3.quantile(cleanValues, 0.98);

    const color = config.diverging
        ? d3.scaleDiverging(config.interpolator)
            .domain([
                -Math.max(Math.abs(vmin), Math.abs(vmax)),
                0,
                Math.max(Math.abs(vmin), Math.abs(vmax)),
            ])
            .clamp(true)
        : d3.scaleSequential(config.interpolator)
            .domain([vmin, vmax])
            .clamp(true);

    colorScaleCache.set(key, color);
    return color;
}

// ---------- tooltip info panel ----------
function drawInfoPanel(point, leftData, rightData, color) {
    const div = d3.select('#info-panel');
    const config = FEATURE_CONFIG[state.feature];

    if (!point) {
        div.html('Click a point on either map.');
        return;
    }

    const leftCell = findNearestCell(leftData.cells, point.lat, point.lon);
    const rightCell = findNearestCell(rightData.cells, point.lat, point.lon);

    const yIdxL = yearIndexes.get(`${leftData.variable}_${leftData.ssp}`).get(state.yearLeft);
    const yIdxR = yearIndexes.get(`${rightData.variable}_${rightData.ssp}`).get(state.yearRight);

    const vL = leftCell?.v[yIdxL];
    const vR = rightCell?.v[yIdxR];
    const valid = v => v != null && !isNaN(v);
    const fmt = v => valid(v) ? v.toFixed(2) : '—';
    const unit = leftData.unit;

    const diff = (valid(vL) && valid(vR)) ? vR - vL : null;
    const diffStr = diff == null
        ? '—'
        : `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`;
    const diffClass = diff == null ? '' : (diff >= 0 ? 'diff-pos' : 'diff-neg');

    div.html(`
    <div class="label">Coordinate</div>
    <div class="value">${point.lat.toFixed(2)}°, ${point.lon.toFixed(2)}°</div>
    <hr style="margin: 8px 0; border: 0; border-top: 1px solid #ddd;">
    <div class="label">Metric</div>
    <div class="value">${config.label}</div>
    <hr style="margin: 8px 0; border: 0; border-top: 1px solid #ddd;">
    <div class="label">Left (${SSP_INFO[leftData.ssp].label.split(' — ')[0]}, ${state.yearLeft})</div>
    <div class="value">${fmt(vL)} ${unit}</div>
    <div class="label" style="margin-top:6px;">Right (${SSP_INFO[rightData.ssp].label.split(' — ')[0]}, ${state.yearRight})</div>
    <div class="value">${fmt(vR)} ${unit}</div>
    <hr style="margin: 8px 0; border: 0; border-top: 1px solid #ddd;">
    <div class="label">Difference (right − left)</div>
    <div class="value ${diffClass}">${diffStr} ${unit}</div>
  `);
}

// ---------- tooltip efficiency ----------
function updateMarkersAndInfo() {
    const leftData = datasets.get(`${state.feature}_${state.left.ssp}`);
    const rightData = datasets.get(`${state.feature}_${state.right.ssp}`);
    if (!leftData || !rightData) return;

    for (const selector of ['#map-left', '#map-right']) {
        // Wipe ANY existing markers in this map's container, wherever they are
        d3.select(selector).selectAll('circle.marker').remove();

        if (state.clickedPoint) {
            const mainSvg = d3.select(selector).select('svg.main-svg').node();
            const overlay = d3.select(selector).select('svg.marker-svg');
            if (!mainSvg || overlay.empty()) continue;

            const t = d3.zoomTransform(mainSvg);
            const [px, py] = PROJECTION([state.clickedPoint.lon, state.clickedPoint.lat]);

            overlay.append('circle')
                .attr('class', 'marker')
                .attr('r', 5)
                .attr('cx', t.applyX(px))
                .attr('cy', t.applyY(py));
        }
    }

    drawInfoPanel(state.clickedPoint, leftData, rightData);
}


// ---------- Render: called whenever state changes ----------
async function render() {
    const leftData = await ensureDataset(state.feature, state.left.ssp);
    const rightData = await ensureDataset(state.feature, state.right.ssp);

    const color = getColorScale(state.feature, leftData, rightData);
    const config = FEATURE_CONFIG[state.feature];

    drawLegend(color, config.label, leftData.unit, config.diverging);
    drawInfoPanel(state.clickedPoint, leftData, rightData, color);
    drawMap('#map-left', leftData, state.yearLeft, color);
    drawMap('#map-right', rightData, state.yearRight, color);

    updateMarkersAndInfo();
}

// ---------- Draw one map into a container ----------
const prevDataPerMap = new Map();

function drawMap(selector, data, year, color) {
    const container = d3.select(selector);
    const key = `${data.variable}_${data.ssp}`;
    const yearIdx = yearIndexes.get(key).get(year);

    // First-time SVG skeleton
    let svg = container.select('svg.main-svg');
    if (svg.empty()) {
        container.style('position', 'relative');

        svg = container.append('svg')
            .attr('class', 'main-svg')
            .attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
            .attr('preserveAspectRatio', 'xMidYMid meet');

        // Click handler — undoes zoom transform before projecting to lat/lon
        svg.on('click', function (event) {
            const [px, py] = d3.pointer(event, svg.node());
            const t = d3.zoomTransform(svg.node());
            const [tx, ty] = t.invert([px, py]);
            const inverted = PROJECTION.invert([tx, ty]);
            if (!inverted) return;
            state.clickedPoint = { lat: inverted[1], lon: inverted[0] };
            updateMarkersAndInfo();
        });

        const clipId = `land-clip-${selector.replace('#', '')}`;
        svg.append('defs')
            .append('clipPath')
            .attr('id', clipId)
            .append('path')
            .attr('d', d3.geoPath(PROJECTION)(land));

        // Cells + countries go inside a zoomable group so they pan/scale together
        const zoomable = svg.append('g').attr('class', 'zoomable');
        zoomable.append('g').attr('class', 'cells-group');
        zoomable.append('path').attr('class', 'countries')
            .attr('fill', 'none')
            .attr('stroke', '#222')
            .attr('stroke-width', 0.5)
            .attr('pointer-events', 'none');

        // Title stays outside zoomable so it doesn't move with pan/zoom
        svg.append('text').attr('class', 'title')
            .attr('x', 10).attr('y', 20).attr('font-size', 14);

        // Separate overlay SVG for the marker (kept outside zoomable so it doesn't scale)
        container.append('svg')
            .attr('class', 'marker-svg')
            .attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .style('position', 'absolute')
            .style('top', 0).style('left', 0)
            .style('width', '100%').style('height', '100%')
            .style('pointer-events', 'none');
    }

    const cellsGroup = svg.select('g.cells-group');

    // Apply land clip for land-only features, remove for everything else
    const clipId = `land-clip-${selector.replace('#', '')}`;
    cellsGroup.attr('clip-path',
        FEATURE_CONFIG[state.feature].landOnly ? `url(#${clipId})` : null);

    // Positional updates only when the data actually changed
    if (prevDataPerMap.get(selector) !== data) {
        const nLat = Math.round(Math.sqrt(data.cells.length / 2));
        const nLon = nLat * 2;
        const cellW = WIDTH / nLon + 0.5;
        const cellH = HEIGHT / nLat + 0.5;

        cellsGroup.selectAll('rect')
            .data(data.cells)
            .join('rect')
            .attr('x', d => {
                const lon = d.lon > 180 ? d.lon - 360 : d.lon;
                return PROJECTION([lon, d.lat])[0] - cellW / 2;
            })
            .attr('y', d => {
                const lon = d.lon > 180 ? d.lon - 360 : d.lon;
                return PROJECTION([lon, d.lat])[1] - cellH / 2;
            })
            .attr('width', cellW)
            .attr('height', cellH)
            .attr('shape-rendering', 'crispEdges');

        const countries = topojson.feature(world, world.objects.countries);
        svg.select('path.countries')
            .datum(countries)
            .attr('d', d3.geoPath(PROJECTION));

        prevDataPerMap.set(selector, data);
    }

    // Always update fills (year may have changed)
    cellsGroup.selectAll('rect')
        .attr('fill', d => {
            const v = d.v[yearIdx];
            return (v == null || isNaN(v)) ? '#fff' : color(v);
        });

    // Update title
    svg.select('text.title')
        .text(`${data.variable} — ${data.ssp} — ${year} — ${data.unit}`);
}


init().catch(err => console.error('init failed:', err));
