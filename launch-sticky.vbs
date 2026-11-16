Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = appDir & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(appDir & "\dist\index.html") Or Not fso.FileExists(appDir & "\dist-electron\main\main.js") Then
  shell.Run "cmd /c cd /d """ & appDir & """ && npm run build && """ & electronExe & """ .", 0, False
Else
  shell.Run """" & electronExe & """ """ & appDir & """", 0, False
End If
