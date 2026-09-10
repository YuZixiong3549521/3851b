@echo off
cd /d "%~dp0.."
call npm run db:up
if errorlevel 1 goto failed
call npm start
:failed
pause
