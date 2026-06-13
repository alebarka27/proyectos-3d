@echo off
cd /d "%~dp0"
echo Iniciando Gestor de Proyectos 3D...
echo.
if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install
)
echo Abri http://localhost:3000 en tu navegador
echo.
start http://localhost:3000
npm start
pause
