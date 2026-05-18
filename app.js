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
