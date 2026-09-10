@echo off
chcp 936 >nul
rem 本文件为 GBK 编码 + CRLF 行尾，勿改为 UTF-8（cmd 解析 UTF-8 批处理会随机错位）
title Simple XiuXian 一键入口
cd /d "%~dp0"
setlocal

:menu
cls
echo ==========================================
echo      === SimpleXiuXian 一键入口 ===
echo ==========================================
echo.
echo  1. 诊断并修复运行环境
echo  2. 启动浏览器版（H5）
echo  3. 启动微信开发者工具版
echo  4. 拉取最新版本
echo  5. 提交并推送 origin main
echo  6. 构建发布包（校验 + 小程序 + H5）
echo  0. 退出
echo.
set "CHOICE="
set /p CHOICE=请输入编号后回车：
set "CHOICE=%CHOICE:~0,1%"
if "%CHOICE%"=="1" goto doctor
if "%CHOICE%"=="2" goto startweb
if "%CHOICE%"=="3" goto startweapp
if "%CHOICE%"=="4" goto pull
if "%CHOICE%"=="5" goto push
if "%CHOICE%"=="6" goto buildall
if "%CHOICE%"=="0" exit
goto menu

rem ---------- 1. 诊断并修复运行环境 ----------
:doctor
cls
echo === 诊断并修复运行环境 ===
echo.
echo [1/5] 检查 Node.js ...
where node >nul 2>nul
if errorlevel 1 (
    echo   [X] 未检测到 Node.js，请先安装 18 以上版本：https://nodejs.org
    pause
    goto menu
)
for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
echo   [OK] Node.js %NODE_VER%
echo.
echo [2/5] 检查 pnpm ...
where pnpm >nul 2>nul
if errorlevel 1 (
    echo   [!] 未检测到 pnpm，尝试通过 corepack 启用 ...
    call corepack enable >nul 2>nul
    where pnpm >nul 2>nul
    if errorlevel 1 (
        echo   [!] corepack 不可用，改用 npm 全局安装 pnpm@10.6.2 ...
        call npm install -g pnpm@10.6.2
    )
)
call pnpm -v >nul 2>nul
if errorlevel 1 (
    echo   [X] pnpm 仍不可用，请手动执行：npm install -g pnpm@10.6.2
    pause
    goto menu
)
for /f "delims=" %%v in ('pnpm -v') do set "PNPM_VER=%%v"
echo   [OK] pnpm %PNPM_VER%
echo.
echo [3/5] 检查依赖 node_modules ...
if not exist "node_modules" (
    echo   [!] 未安装依赖，执行 pnpm install ...
    call pnpm install
    if errorlevel 1 (
        echo   [X] 依赖安装失败
        pause
        goto menu
    )
) else (
    echo   [OK] 依赖已安装
)
echo.
echo [4/5] 构建引擎包 @simple-xiuxian/engine ...
call pnpm --filter @simple-xiuxian/engine build
if errorlevel 1 (
    echo   [X] 引擎构建失败
    pause
    goto menu
)
echo   [OK] 引擎构建完成
echo.
echo [5/5] 检查 git 远程 ...
git remote get-url origin >nul 2>nul
if errorlevel 1 (
    echo   [!] 未配置 origin 远程，推送/拉取功能不可用
) else (
    for /f "delims=" %%u in ('git remote get-url origin') do echo   [OK] origin = %%u
)
echo.
echo === 诊断完成，环境就绪 ===
pause
goto menu

rem ---------- 2. 启动浏览器版（H5） ----------
:startweb
cls
echo === 启动浏览器版（H5） ===
echo.
echo [1/3] 构建 H5 产物（约十几秒）...
call pnpm --filter @simple-xiuxian/miniapp build:h5
if errorlevel 1 (
    echo   [X] H5 构建失败
    pause
    goto menu
)
echo.
echo [2/3] 启动本地静态服务（端口 4173）...
netstat -ano | findstr /c:":4173" | findstr /c:"LISTENING" >nul
if errorlevel 1 (
    start "XiuXian H5 服务" cmd /k "chcp 65001 >nul && node scripts\web-serve.mjs 4173"
    timeout /t 2 /nobreak >nul
) else (
    echo   检测到 4173 端口已有服务，直接复用
)
echo.
echo [3/3] 打开浏览器 ...
start "" "http://localhost:4173"
echo.
echo === 浏览器版已启动：http://localhost:4173 ===
echo （服务跑在单独窗口里，关闭那个窗口即停止服务）
pause
goto menu

rem ---------- 3. 启动微信开发者工具版 ----------
:startweapp
cls
echo === 启动微信开发者工具版 ===
echo.
echo [1/2] 启动小程序 watch 构建（dev:weapp，单独窗口）...
start "XiuXian 小程序 watch" cmd /k "chcp 65001 >nul && pnpm --filter @simple-xiuxian/miniapp dev:weapp"
echo   （如该窗口提示找不到 pnpm，请先执行菜单 1 诊断环境）
timeout /t 3 /nobreak >nul
echo.
echo [2/2] 查找微信开发者工具 ...
set "DEVTOOL="
if exist "%ProgramFiles(x86)%\Tencent\微信web开发者工具\cli.bat" set "DEVTOOL=%ProgramFiles(x86)%\Tencent\微信web开发者工具\cli.bat"
if exist "%ProgramFiles%\Tencent\微信web开发者工具\cli.bat" set "DEVTOOL=%ProgramFiles%\Tencent\微信web开发者工具\cli.bat"
if exist "D:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" set "DEVTOOL=D:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
if exist "D:\Program Files\Tencent\微信web开发者工具\cli.bat" set "DEVTOOL=D:\Program Files\Tencent\微信web开发者工具\cli.bat"
if defined DEVTOOL (
    echo   找到开发者工具，尝试打开项目 apps\miniapp ...
    start "" "%DEVTOOL%" open --project "%~dp0apps\miniapp"
    echo   （若工具未弹出，请在开发者工具 设置-安全 中开启服务端口后重试）
) else (
    echo   未找到微信开发者工具，请手动打开后导入目录：
    echo   %~dp0apps\miniapp
)
echo.
echo === 小程序 watch 构建已在单独窗口运行，改动 src 后会自动重编译 ===
pause
goto menu

rem ---------- 4. 拉取最新版本 ----------
:pull
cls
echo === 拉取最新版本（origin main） ===
echo.
git pull --ff-only origin main
if errorlevel 1 (
    echo.
    echo [!] 拉取失败：可能本地有冲突改动或网络不通，处理后再试。
)
echo.
pause
goto menu

rem ---------- 5. 提交并推送 origin main ----------
:push
cls
echo === 提交并推送 origin main ===
echo.
git add -A
echo === 将提交以下改动 ===
echo.
git status --short
echo.
set "MSG="
set /p MSG=请输入提交说明（直接回车用默认“更新”）：
if "%MSG%"=="" set "MSG=更新"
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "%MSG%"
) else (
    echo 没有需要提交的改动
)
echo.
git push origin main
if errorlevel 1 (
    echo.
    echo [!] 推送失败：请先执行 4 拉取最新版本，解决冲突后再试。
)
echo.
pause
goto menu

rem ---------- 6. 构建发布包 ----------
:buildall
cls
echo === 构建发布包（校验 + 小程序 + H5） ===
echo.
echo [1/2] pnpm validate（build + lint + typecheck + 全部测试）...
call pnpm validate
if errorlevel 1 (
    echo.
    echo   [X] 校验失败，已中止构建
    pause
    goto menu
)
echo.
echo [2/2] 构建 H5 产物 ...
call pnpm --filter @simple-xiuxian/miniapp build:h5
if errorlevel 1 (
    echo.
    echo   [X] H5 构建失败
    pause
    goto menu
)
echo.
echo === 构建完成 ===
echo   小程序包：apps\miniapp\dist       （微信开发者工具导入 apps\miniapp）
echo   H5 包：  apps\miniapp\dist-web   （node scripts\web-serve.mjs 4173）
echo.
pause
goto menu
