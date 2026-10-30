@echo off
set BIN_DIR=%~dp0
set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe

echo Compiling ui.exe...
%CSC% /target:winexe /out:"%BIN_DIR%ui.exe" /reference:"%BIN_DIR%Microsoft.Web.WebView2.Core.dll" /reference:"%BIN_DIR%Microsoft.Web.WebView2.WinForms.dll" "%BIN_DIR%ui.cs"

if %ERRORLEVEL% NEQ 0 (
    echo Compilation failed.
    exit /b %ERRORLEVEL%
)

echo Done. Successfully built ui.exe
