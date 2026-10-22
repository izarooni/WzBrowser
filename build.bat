@echo off
rem Builds both programs:
rem   API -> dist\WzBrowser.exe (Release, single self-contained exe)
rem   Web -> WzBrowser.Web\build\client (static site)
setlocal
cd /d "%~dp0"

echo === MapleLib ===
rem Fetch deps\MapleLib at the pinned commit, and make later `git pull`s update it too.
rem Some of MapleLib's files are past Windows' 260-character path limit, hence core.longpaths.
git config submodule.recurse true
git config core.longpaths true
git -c core.longpaths=true submodule update --init --recursive
if errorlevel 1 goto :failed
git -C deps\MapleLib config core.longpaths true

echo.
echo === API (Release) ===
dotnet publish WzBrowser.Api\WzBrowser.Api.csproj -c Release -o dist
if errorlevel 1 goto :failed

echo.
echo === Web ===
pushd WzBrowser.Web
if not exist node_modules (
    call npm ci
    if errorlevel 1 ( popd & goto :failed )
)
call npm run build
if errorlevel 1 ( popd & goto :failed )
popd

rem The exe serves the web app from wwwroot beside it (open http://<server>:5178/).
if exist dist\wwwroot rmdir /s /q dist\wwwroot
xcopy /e /i /q WzBrowser.Web\build\client dist\wwwroot >nul
if errorlevel 1 goto :failed

echo.
echo Done.
echo   API: %~dp0dist\WzBrowser.exe  (serves the web app too)
echo   Web: %~dp0WzBrowser.Web\build\client
exit /b 0

:failed
echo.
echo Build failed.
exit /b 1
