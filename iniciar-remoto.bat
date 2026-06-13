@echo off
cd /d "%~dp0"
echo Iniciando Gestor de Proyectos 3D + Ngrok...
echo.
if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install
)
echo.
:: Verificar si ngrok tiene token configurado
ngrok config check >nul 2>&1
if %errorlevel% neq 0 (
    echo Primero registrate gratis en https://dashboard.ngrok.com/signup
    echo Luego ejecuta: ngrok config add-authtoken TU_TOKEN
    echo.
    pause
    exit /b
)
echo Ngrok URL aparecera abajo. Abrila desde el celular.
echo.
start http://localhost:4040
start http://localhost:3000
start ngrok http 3000
npm start
pause
