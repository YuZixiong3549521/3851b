@echo off
cd /d "%~dp0"
if not exist "coolcare\node_modules" call npm run setup
if errorlevel 1 goto failed
if not exist "coolcare\technician\node_modules" call npm run setup
if errorlevel 1 goto failed
if not exist "coolcare\.env.local" call npm --prefix coolcare run setup
if errorlevel 1 goto failed
call npm run db:up
if errorlevel 1 goto failed
call npm start
:failed
pause
