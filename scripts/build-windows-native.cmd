@echo off
setlocal
cd /d "%~dp0.."
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "BIU_VS=%%i"
if not defined BIU_VS (
  echo Visual Studio C++ Build Tools are required.
  exit /b 1
)
call "%BIU_VS%\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b 1
if not exist dist\windows-native mkdir dist\windows-native
pushd dist\windows-native
cl /nologo /O2 /LD /MT /EHsc /DWIREHAIR_BUILDING /DWIREHAIR_DLL /I..\..\cloud-video ..\..\cloud-video\wirehair\wirehair.cpp ..\..\cloud-video\wirehair\WirehairCodec.cpp ..\..\cloud-video\wirehair\WirehairTools.cpp ..\..\cloud-video\wirehair\gf256.cpp /link /OUT:wirehair.dll
set "BIU_RESULT=%ERRORLEVEL%"
popd
exit /b %BIU_RESULT%
