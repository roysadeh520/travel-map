@echo off
rem Local preview of the site, before anything goes to GitHub.
rem Computer: http://localhost:8766   Phone (same Wi-Fi): http://<this PC's IP>:8766
rem After a code change press Ctrl+F5 in the browser to skip the cache. Close this window to stop.
cd /d "%~dp0"
start "" http://localhost:8766
python -m http.server 8766 --bind 0.0.0.0
