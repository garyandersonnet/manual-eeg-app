import FFT from 'fft.js';  // or import your chosen lib

// Buffers per channel (e.g., for ~10s windows at 256Hz)
const BUFFER_SIZE = 2560;  // adjust for your needs
const channelBuffers = { 0: [], 1: [], 2: [], 3: [] };
let classificationHistory = [];

// Frequency bands (Hz)
const BANDS = {
  delta: [0.5, 4],
  theta: [4, 8],
  alpha: [8, 13],
  sigma: [12, 16],  // sleep spindles
  beta:  [13, 30],
  gamma: [30, 50]
};

client.eegReadings.subscribe(reading => {
  const ch = reading.electrode;
  channelBuffers[ch].push(...reading.samples);
  
  // Keep buffer size reasonable
  if (channelBuffers[ch].length > BUFFER_SIZE * 2) {
    channelBuffers[ch] = channelBuffers[ch].slice(-BUFFER_SIZE);
  }

  // Every N samples, process (e.g., throttle)
  if (channelBuffers[ch].length >= BUFFER_SIZE && ch === 0) {  // process on one channel or average
    const result = classifySleepStage();
    updateUI(result);
  }
});

function classifySleepStage() {
  // Use AF7 or average channels for simplicity
  let signal = channelBuffers[1];  // AF7 often good
  if (signal.length < 256) return { stage: 'Unknown', confidence: 0 };

  // Detrend (remove DC offset)
  const mean = signal.reduce((a,b)=>a+b,0) / signal.length;
  signal = signal.map(x => x - mean);

  // FFT
  const fftSize = 256;  // power of 2
  const fft = new FFT(fftSize);
  const phasors = fft.createComplexArray();
  const spectrum = new Float32Array(fftSize);

  // Take last window
  const window = signal.slice(-fftSize);
  fft.realTransform(phasors, window);  // or use your lib's API
  // Compute magnitude
  for (let i = 0; i < fftSize/2; i++) {
    spectrum[i] = Math.sqrt(phasors[2*i]**2 + phasors[2*i+1]**2);
  }

  // Band powers (normalize by total power)
  const fs = 256;  // Muse sampling rate
  const freqResolution = fs / fftSize;
  const totalPower = spectrum.reduce((a,b)=>a+b,0) || 1;

  const bandPowers = {};
  Object.keys(BANDS).forEach(band => {
    const [low, high] = BANDS[band];
    let power = 0;
    const startBin = Math.ceil(low / freqResolution);
    const endBin = Math.floor(high / freqResolution);
    for (let i = startBin; i <= Math.min(endBin, spectrum.length-1); i++) {
      power += spectrum[i];
    }
    bandPowers[band] = power / totalPower;
  });

  // Simple rule-based classifier (improve with ML later)
  let stage = 'Wake';
  let confidence = 0.6;

  if (bandPowers.delta > 0.4) {
    stage = 'N3 (Deep)';
    confidence = 0.8;
  } else if (bandPowers.theta > 0.35 && bandPowers.delta < 0.25) {
    stage = 'N1/N2 (Light)';
    confidence = 0.7;
  } else if (bandPowers.alpha > 0.3) {
    stage = 'Wake / Relaxed';
    confidence = 0.75;
  } else if (bandPowers.theta > 0.25 && bandPowers.beta > 0.2) {
    stage = 'REM';
    confidence = 0.65;
  }

  classificationHistory.push({ stage, timestamp: Date.now(), bandPowers });
  if (classificationHistory.length > 20) classificationHistory.shift();

  return { stage, confidence, bandPowers, history: classificationHistory };
}

function updateUI(result) {
  // Add to your HTML: a new div for sleep stage
  const stageEl = document.getElementById('sleepStage') || createStageElement();
  stageEl.innerHTML = `
    <strong>Sleep Stage:</strong> ${result.stage} 
    <span style="color: ${result.confidence > 0.7 ? 'green' : 'orange'}">
      (${Math.round(result.confidence*100)}% conf)
    </span>
    <br><small>Delta: ${(result.bandPowers.delta*100).toFixed(1)}% | Theta: ${(result.bandPowers.theta*100).toFixed(1)}%</small>
  `;
}

import { MuseClient } from 'muse-js';

const client = new MuseClient();
const connectBtn = document.getElementById('connectBtn');
const statusDiv = document.getElementById('status');
const outputPre = document.getElementById('output');

connectBtn.addEventListener('click', async () => {
    try {
        statusDiv.innerText = "Status: Scanning via Web Bluetooth Tunnel...";
        statusDiv.style.color = "#0071e3";

        await client.connect();
        
        statusDiv.innerText = "Status: Connected! Streaming brainwaves...";
        statusDiv.style.color = "#34c759";

        await client.start();

        client.eegReadings.subscribe(reading => {
            outputPre.innerText = `Channel: [${reading.electrode}] (0=TP9, 1=AF7, 2=AF8, 3=TP10)\nTimestamp: ${reading.timestamp}\nMicrovolt Samples:\n${JSON.stringify(reading.samples, null, 2)}`;
        });

    } catch (err) {
        statusDiv.innerText = `Status: Connection Failed`;
        statusDiv.style.color = "#ff3b30";
        outputPre.innerText = `Error:\n${err.message}`;
        console.error(err);
    }
});
