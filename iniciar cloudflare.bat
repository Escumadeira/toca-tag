@echo off
title TOCA tag - Cloudflare
cd /d "%~dp0"

rem Liga o tunel da Cloudflare (dominio tocatag.net) e depois o servidor.
rem O token do tunel fica em tunel-token.txt, nesta pasta.
set "TUNNEL_TOKEN="
if not exist "tunel-token.txt" type nul > "tunel-token.txt"
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "$t=Get-Content 'tunel-token.txt' -Raw; if($t){(($t.Trim()) -split '\s+')[-1]}" 2^>nul`) do set "TUNNEL_TOKEN=%%T"
if defined TUNNEL_TOKEN goto cloudflared

echo.
echo  Falta o token do tunel.
echo.
echo  1. No painel da Cloudflare: Rede, Tuneis, tocatag, Adicionar uma replica.
echo  2. Clique no icone de copiar ao lado do comando.
echo  3. Cole no arquivo tunel-token.txt (vai abrir agora), salve e feche.
echo  4. Abra este arquivo de novo.
echo.
start "" notepad "tunel-token.txt"
pause
exit /b 1

:cloudflared
set "CFD=cloudflared"
where cloudflared >nul 2>nul
if not errorlevel 1 goto ligar
if exist "cloudflared.exe" goto cfdlocal
echo.
echo  Baixando o cloudflared (tunel da Cloudflare) para esta pasta...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
if exist "cloudflared.exe" goto cfdlocal
echo.
echo  Nao foi possivel baixar o cloudflared. Confira a internet e tente de novo.
echo.
pause
exit /b 1

:cfdlocal
set "CFD=%~dp0cloudflared.exe"

:ligar
set "TOCA_PORTA_FIXA=1"
start "TOCA tag - tunel (nao feche)" /min "%CFD%" tunnel run
echo.
echo  Tunel ligado. O TOCA tag vai ficar em https://tocatag.net
echo.
call "%~dp0iniciar.bat"
