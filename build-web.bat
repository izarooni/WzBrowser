@echo off
rem Builds the web app into dist\wwwroot (static site).
rem Files put there by hand, such as config.json, are left alone.
setlocal
cd /d "%~dp0"

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
echo   Web: %~dp0dist\wwwroot
exit /b 0

:failed
echo.
echo Build failed.
exit /b 1
