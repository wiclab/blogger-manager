@echo off
setlocal EnableExtensions
rem User-owned PC only; never sends login cookies, passwords or Google tokens to GitHub.
cd /d "%~dp0.."
set "BLOGGER_BYEOL_ID=1659014803305858421"
if not exist ".local" mkdir ".local"
if not defined BYEOL_DRIVE_QUEUE_DIR (
  if exist ".local\byeolsemso-drive-path.txt" (
    set /p BYEOL_DRIVE_QUEUE_DIR=<".local\byeolsemso-drive-path.txt"
  )
)
if not defined BYEOL_DRIVE_QUEUE_DIR (
  echo Enter the full local folder path from Google Drive for desktop.
  set /p BYEOL_DRIVE_QUEUE_DIR=Drive folder path: 
  if not defined BYEOL_DRIVE_QUEUE_DIR goto :end
  >".local\byeolsemso-drive-path.txt" echo %BYEOL_DRIVE_QUEUE_DIR%
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22+ is required. See docs/BLOGGER_NATIVE_IMAGE_PC_SETUP.md
  goto :end
)
if not exist "node_modules\playwright" (
  echo Playwright is not installed. Follow the one-time setup instructions.
  goto :end
)
echo Checking queue: %BYEOL_DRIVE_QUEUE_DIR%
node scripts\blogger_native_image_queue.cjs --queue "%BYEOL_DRIVE_QUEUE_DIR%" --check
if /i "%~1"=="--watch" goto :watch
node scripts\blogger_native_image_queue.cjs --queue "%BYEOL_DRIVE_QUEUE_DIR%" --run
goto :end
:watch
echo Watch mode: check every 15 minutes while this PC is awake and this window stays open.
:cycle
node scripts\blogger_native_image_queue.cjs --queue "%BYEOL_DRIVE_QUEUE_DIR%" --run
timeout /t 900 /nobreak >nul
goto :cycle
:end
if /i not "%~1"=="--watch" pause
endlocal
