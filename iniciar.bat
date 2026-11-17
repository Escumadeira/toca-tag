@echo off
title TOCA tag
cd /d "%~dp0"
set "NODE=node"

where node >nul 2>nul
if not errorlevel 1 goto rodar
if exist "node\node.exe" goto portatil

echo.
echo  Primeira vez: baixando o Node.js para dentro desta pasta...
echo  Isso leva cerca de um minuto e precisa de internet.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $v='v22.12.0'; $n='node-'+$v+'-win-x64'; $z=Join-Path $env:TEMP 'toca-node.zip'; Invoke-WebRequest -UseBasicParsing ('https://nodejs.org/dist/'+$v+'/'+$n+'.zip') -OutFile $z; Expand-Archive -Force $z '.'; if (Test-Path 'node') { Remove-Item -Recurse -Force 'node' }; Rename-Item $n 'node'; Remove-Item $z"

if exist "node\node.exe" goto portatil
echo.
echo  Nao foi possivel baixar o Node.js automaticamente.
echo  Confira a internet e abra este arquivo de novo,
echo  ou instale manualmente em https://nodejs.org (versao LTS).
echo.
pause
exit /b 1

:portatil
set "NODE=%~dp0node\node.exe"

:rodar
"%NODE%" server.js
if errorlevel 1 goto parou
echo.
echo  Reiniciando o TOCA tag...
echo.
goto rodar

:parou
echo.
echo  O TOCA tag foi desligado. Feche tambem a janela do tunel, se estiver aberta.
pause
