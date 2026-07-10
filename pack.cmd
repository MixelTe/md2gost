@echo off
:: Enable ANSI escape codes if they are not already enabled
cls

for /F "tokens=1,2 delims=#" %%a in ('"prompt #$H#$E# & echo on & for %%b in (1) do rem"') do set "ESC=%%b"
set "GREEN=%ESC%[92m"
set "RED=%ESC%[91m"
set "YELLOW=%ESC%[93m"
set "RESET=%ESC%[0m"

echo Starting Packaging Process...

call npm run lint
if %errorlevel% neq 0 (
    echo %RED%Error: lint script failed.%RESET%
    goto RESTORE
)

call npm run check-types
if %errorlevel% neq 0 (
    echo %RED%Error: check-types script failed.%RESET%
    goto RESTORE
)

if exist README.md (
    echo %YELLOW%Backing up original README.md...%RESET%
    copy /y README.md bak_README.md >nul
)

echo Running job: pack-vscode...

call npx @vscode/vsce package
if %errorlevel% neq 0 (
    echo %RED%Error: VSCE package failed.%RESET%
    goto RESTORE
)

echo Running job: pack-npm...

call npm run build:npm
if %errorlevel% neq 0 (
    echo %RED%Error: NPM build failed.%RESET%
    goto RESTORE
)

call npm run build:npm-readme
if %errorlevel% neq 0 (
    echo %RED%Error: NPM readme build failed.%RESET%
    goto RESTORE
)

copy /y README-NPM.md README.md >nul
if %errorlevel% neq 0 (
    echo %RED%Error: Failed to copy README-NPM.md.%RESET%
    goto RESTORE
)

call npm pack
if %errorlevel% neq 0 (
    echo %RED%Error: NPM pack failed.%RESET%
    goto RESTORE
)

call npm run test:artifacts
if %errorlevel% neq 0 (
    goto RESTORE
)

echo %GREEN%Packaging completed successfully!%RESET%

:RESTORE
if exist bak_README.md (
    echo %YELLOW%Restoring original README.md...%RESET%
    move /y bak_README.md README.md >nul
) else (
    if exist README-NPM.md del /f /q README.md >nul
)

pause
