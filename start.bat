@echo off
cd /d %~dp0
echo Earth starting at http://localhost:8899
start http://localhost:8899
py -m http.server 8899
