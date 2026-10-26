@echo off
rem Builds both programs and copies them into dist:
rem   API -> dist\WzBrowser.exe (Release, single self-contained exe)
rem   Web -> dist\wwwroot (static site)
rem Files put in dist by hand, such as appsettings.json and wwwroot\config.json, are left alone.
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
dotnet publish WzBrowser.Api\WzBrowser.Api.csproj -c Release -o WzBrowser.Api\bin\publish
if errorlevel 1 goto :failed
if not exist dist mkdir dist
copy /y WzBrowser.Api\bin\publish\WzBrowser.exe dist\ >nul
if errorlevel 1 ( echo Could not replace dist\WzBrowser.exe. Close it if it's running and build again. & goto :failed )

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
rem Robocopy exits below 8 on success. assets is mirrored so old hashed bundles don't pile up.
robocopy WzBrowser.Web\build\client dist\wwwroot /e /xd assets /njh /njs /nfl /ndl >nul
if errorlevel 8 goto :failed
robocopy WzBrowser.Web\build\client\assets dist\wwwroot\assets /mir /njh /njs /nfl /ndl >nul
if errorlevel 8 goto :failed

echo.
echo Done.
echo   API: %~dp0dist\WzBrowser.exe
echo   Web: %~dp0dist\wwwroot
exit /b 0

:failed
echo.
echo Build failed.
exit /b 1
