import FFT from 'fft.js';
import { MuseClient, EEG_FREQUENCY } from 'muse-js';

const client = new MuseClient();
const FFT_SIZE = 512;
const fft = new FFT(FFT_SIZE);
const fftOutput = fft.createComplexArray();
const eegBands = [
    { key: 'delta', min: 0.5, max: 4, color: '#0071e3' },
    { key: 'theta', min: 4, max: 8, color: '#34c759' },
    { key: 'alpha', min: 8, max: 13, color: '#ff9500' },
    { key: 'beta', min: 13, max: 30, color: '#af52de' },
    { key: 'gamma', min: 30, max: 100, color: '#ff2d55' }
];
const MAX_CHART_POINTS = 120;
const MIN_DELTA_TONE_HZ = 180;
const MAX_DELTA_TONE_HZ = 880;
const connectBtn = document.getElementById('connectBtn');
const statusDiv = document.getElementById('status');
const outputPre = document.getElementById('output');
const audioStatus = document.getElementById('audioStatus');
const voltageFields = [0, 1, 2, 3].map(electrode => ({
    value: document.getElementById(`voltage-${electrode}`),
    timestamp: document.getElementById(`timestamp-${electrode}`),
    bands: Object.fromEntries(eegBands.map(({ key }) => [
        key,
        document.getElementById(`${key}-${electrode}`)
    ]))
}));
const bandCharts = Object.fromEntries(eegBands.map(band => [
    band.key,
    {
        canvas: document.getElementById(`${band.key}-chart`),
        value: document.getElementById(`${band.key}-average`),
        color: band.color,
        history: []
    }
]));
const latestPositiveVoltages = [null, null, null, null];
const latestBandPowers = [null, null, null, null];
const electrodeBuffers = [[], [], [], []];
let streamStartTimestamp = null;
let audioContext = null;
let deltaOscillator = null;
let deltaGain = null;
let peakDeltaAverage = 1;

function formatMicrovolts(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '--';
    }

    return value.toPrecision(4);
}

function resizeCanvasForDisplay(canvas) {
    const pixelRatio = window.devicePixelRatio || 1;
    const displayWidth = Math.round(canvas.clientWidth * pixelRatio);
    const displayHeight = Math.round(canvas.clientHeight * pixelRatio);

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
    }
}

function drawBandChart(chart) {
    const { canvas, color, history } = chart;
    const context = canvas.getContext('2d');
    const pixelRatio = window.devicePixelRatio || 1;
    resizeCanvasForDisplay(canvas);

    const { width, height } = canvas;
    const padding = 18 * pixelRatio;
    context.clearRect(0, 0, width, height);

    context.strokeStyle = '#e5e5ea';
    context.lineWidth = pixelRatio;
    context.beginPath();
    for (let index = 1; index <= 3; index += 1) {
        const y = padding + ((height - (padding * 2)) * index) / 4;
        context.moveTo(padding, y);
        context.lineTo(width - padding, y);
    }
    context.stroke();

    if (history.length < 2) {
        context.fillStyle = '#86868b';
        context.font = `${12 * pixelRatio}px -apple-system, BlinkMacSystemFont, sans-serif`;
        context.textAlign = 'center';
        context.fillText('Waiting for band averages', width / 2, height / 2);
        return;
    }

    const maxValue = Math.max(...history, 1);
    const minValue = Math.min(...history, 0);
    const valueRange = Math.max(maxValue - minValue, maxValue * 0.1, 1);
    const drawableWidth = width - (padding * 2);
    const drawableHeight = height - (padding * 2);

    context.strokeStyle = color;
    context.lineWidth = 2.5 * pixelRatio;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();

    history.forEach((value, index) => {
        const x = padding + (drawableWidth * index) / Math.max(history.length - 1, 1);
        const normalized = (value - minValue) / valueRange;
        const y = height - padding - (normalized * drawableHeight);

        if (index === 0) {
            context.moveTo(x, y);
        } else {
            context.lineTo(x, y);
        }
    });

    context.stroke();
}

function drawAllBandCharts() {
    Object.values(bandCharts).forEach(drawBandChart);
}

async function startDeltaTone() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
        audioStatus.innerText = 'Delta tone: unavailable';
        return;
    }

    if (!audioContext) {
        audioContext = new AudioContext();
        deltaOscillator = audioContext.createOscillator();
        deltaGain = audioContext.createGain();
        deltaOscillator.type = 'sine';
        deltaOscillator.frequency.value = MIN_DELTA_TONE_HZ;
        deltaGain.gain.value = 0.03;
        deltaOscillator.connect(deltaGain);
        deltaGain.connect(audioContext.destination);
        deltaOscillator.start();
    }

    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    audioStatus.innerText = `Delta tone: ${Math.round(MIN_DELTA_TONE_HZ)} Hz`;
}

function updateDeltaTone(deltaAverage) {
    if (!audioContext || !deltaOscillator) {
        return;
    }

    peakDeltaAverage = Math.max(peakDeltaAverage * 0.995, deltaAverage, 1);
    const normalizedDelta = Math.min(Math.max(deltaAverage / peakDeltaAverage, 0), 1);
    const frequency = MIN_DELTA_TONE_HZ + (normalizedDelta * (MAX_DELTA_TONE_HZ - MIN_DELTA_TONE_HZ));
    const now = audioContext.currentTime;
    deltaOscillator.frequency.setTargetAtTime(frequency, now, 0.08);
    audioStatus.innerText = `Delta tone: ${Math.round(frequency)} Hz`;
}

function calculateBandPowers(samples) {
    if (samples.length < FFT_SIZE) {
        return null;
    }

    const recentSamples = samples.slice(-FFT_SIZE);
    const mean = recentSamples.reduce((total, sample) => total + sample, 0) / FFT_SIZE;
    const windowedSamples = recentSamples.map((sample, index) => {
        const hann = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1)));
        return (sample - mean) * hann;
    });

    fft.realTransform(fftOutput, windowedSamples);
    fft.completeSpectrum(fftOutput);

    return eegBands.reduce((powers, band) => {
        let totalPower = 0;
        let binCount = 0;

        for (let bin = 1; bin <= FFT_SIZE / 2; bin += 1) {
            const frequency = (bin * EEG_FREQUENCY) / FFT_SIZE;
            if (frequency >= band.min && frequency < band.max) {
                const real = fftOutput[bin * 2];
                const imaginary = fftOutput[(bin * 2) + 1];
                totalPower += (real * real) + (imaginary * imaginary);
                binCount += 1;
            }
        }

        powers[band.key] = binCount > 0 ? totalPower / binCount : 0;
        return powers;
    }, {});
}

function updateBandFields(field, bandPowers) {
    if (!bandPowers) {
        return;
    }

    eegBands.forEach(({ key }) => {
        field.bands[key].innerText = formatMicrovolts(bandPowers[key]);
    });
}

function updateAverageBandCharts() {
    eegBands.forEach(({ key }) => {
        const values = latestBandPowers
            .map(bandPowers => bandPowers?.[key])
            .filter(value => typeof value === 'number' && !Number.isNaN(value));
        const chart = bandCharts[key];

        if (values.length === 0) {
            chart.value.innerText = '--';
            drawBandChart(chart);
            return;
        }

        const average = values.reduce((total, value) => total + value, 0) / values.length;
        chart.value.innerText = formatMicrovolts(average);
        chart.history.push(average);
        if (chart.history.length > MAX_CHART_POINTS) {
            chart.history.splice(0, chart.history.length - MAX_CHART_POINTS);
        }
        drawBandChart(chart);

        if (key === 'delta') {
            updateDeltaTone(average);
        }
    });
}

function resetStreamState() {
    streamStartTimestamp = null;
    peakDeltaAverage = 1;
    latestPositiveVoltages.fill(null);
    latestBandPowers.fill(null);
    electrodeBuffers.forEach(buffer => buffer.splice(0, buffer.length));
    Object.values(bandCharts).forEach(chart => {
        chart.history.splice(0, chart.history.length);
        chart.value.innerText = '--';
    });
    voltageFields.forEach(field => {
        field.value.innerText = '--';
        field.timestamp.innerText = 'Waiting for data';
        eegBands.forEach(({ key }) => {
            field.bands[key].innerText = '--';
        });
    });
    audioStatus.innerText = audioContext ? `Delta tone: ${Math.round(MIN_DELTA_TONE_HZ)} Hz` : 'Delta tone: off';
    drawAllBandCharts();
}

function updateVoltageField(reading) {
    const field = voltageFields[reading.electrode];
    if (!field) {
        return;
    }

    if (streamStartTimestamp === null) {
        streamStartTimestamp = reading.timestamp;
    }

    const latestSample = reading.samples[reading.samples.length - 1];
    electrodeBuffers[reading.electrode].push(...reading.samples);
    if (electrodeBuffers[reading.electrode].length > FFT_SIZE) {
        electrodeBuffers[reading.electrode].splice(0, electrodeBuffers[reading.electrode].length - FFT_SIZE);
    }

    if (latestSample > 0) {
        latestPositiveVoltages[reading.electrode] = latestSample;
    }

    const displaySample = latestSample < 0 ? latestPositiveVoltages[reading.electrode] : latestSample;
    const elapsedMilliseconds = Math.round(reading.timestamp - streamStartTimestamp);
    field.value.innerText = formatMicrovolts(displaySample);
    field.timestamp.innerText = `${elapsedMilliseconds} ms since start`;
    const bandPowers = calculateBandPowers(electrodeBuffers[reading.electrode]);
    updateBandFields(field, bandPowers);

    if (bandPowers) {
        latestBandPowers[reading.electrode] = bandPowers;
        updateAverageBandCharts();
    }
}

window.addEventListener('resize', drawAllBandCharts);
drawAllBandCharts();

connectBtn.addEventListener('click', async () => {
    try {
        resetStreamState();
        await startDeltaTone();
        statusDiv.innerText = "Status: Scanning via Web Bluetooth Tunnel...";
        statusDiv.style.color = "#0071e3";

        await client.connect();
        
        statusDiv.innerText = "Status: Connected! Streaming brainwaves...";
        statusDiv.style.color = "#34c759";

        await client.start();

        client.eegReadings.subscribe(reading => {
            updateVoltageField(reading);
            outputPre.innerText = `Latest channel: ${reading.electrode}\nTime since start: ${Math.round(reading.timestamp - streamStartTimestamp)} ms`;
        });

    } catch (err) {
        statusDiv.innerText = `Status: Connection Failed`;
        statusDiv.style.color = "#ff3b30";
        outputPre.innerText = `Error:\n${err.message}`;
        console.error(err);
    }
});
