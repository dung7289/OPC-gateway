' Launch Industrial Gateway silently in the background (no console window).
Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = baseDir
WshShell.Run """" & baseDir & "\IndustrialGateway.exe""", 0, False
