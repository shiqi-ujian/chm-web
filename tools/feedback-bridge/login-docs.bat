@echo off
cd /d "%~dp0..\.."
echo Opening Tencent Docs login page with the bridge profile (docs-profile).
echo Please login with QQ in the window that opens, then close it.
node tools\feedback-bridge\collect-docs.mjs --login
if "%WZ_NO_PAUSE%"=="" pause >nul
