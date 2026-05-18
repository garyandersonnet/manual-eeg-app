# manual-eeg-app
remote app for eeg monitoring
setup:


```bash
# Code block title or comment here
cd ~/manual-eeg-app
npm install
npx esbuild app.js --bundle --outfile=bundle.js
npx serve -l 3000


on mac
```bash
python3 -m http.server 3000
