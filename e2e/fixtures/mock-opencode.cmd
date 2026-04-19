@echo off
REM Mock 'opencode' executable for Pixel Agents e2e tests (Windows).
REM
REM Supported commands:
REM   opencode session list --format json
REM   opencode mock-runtime <session-id>

setlocal enabledelayedexpansion

if defined HOME (
  set "MOCK_HOME=%HOME%"
) else (
  set "MOCK_HOME=%USERPROFILE%"
)

set "LOG_DIR=%MOCK_HOME%\.opencode-mock"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
echo %DATE% %TIME% cwd=%CD% args=%* >> "%LOG_DIR%\invocations.log"

if /I "%~1"=="session" if /I "%~2"=="list" if /I "%~3"=="--format" if /I "%~4"=="json" (
  if defined OPENCODE_MOCK_SESSION_LIST_FILE (
    type "%OPENCODE_MOCK_SESSION_LIST_FILE%"
  ) else (
    echo []
  )
  exit /b 0
)

if /I "%~1"=="mock-runtime" (
  set "SESSION_ID=%~2"
  if "%SESSION_ID%"=="" set "SESSION_ID=mock-session"
  echo %DATE% %TIME% mode=mock-runtime session=%SESSION_ID% >> "%LOG_DIR%\invocations.log"
  powershell -NoProfile -File "%~dp0mock-opencode-runtime.ps1" opencode "%SESSION_ID%" -opencode-mock-runtime
  exit /b 0
)

>&2 echo mock-opencode: unsupported args: %*
exit /b 1
