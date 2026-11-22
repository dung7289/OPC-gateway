Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Lay duong dan thu muc hien tai
strCurDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Neu may moi chua cai dat venv, tu dong chay bo cai dat auto_setup.bat
If Not fso.FileExists(strCurDir & "\backend\venv\Scripts\python.exe") Then
    WshShell.Run "cmd /c """ & strCurDir & "\auto_setup.bat""", 1, True
End If

' 2. Chay server Industrial Gateway an ngam (0 = Hidden, khong hien cua so den CMD)
WshShell.Run "cmd /c """ & strCurDir & "\run_backend.bat""", 0, False

' 3. Cho 3 giay de server khoi dong hoan tat roi tu dong mo trinh duyet Web
WScript.Sleep 3000
WshShell.Run "http://localhost:8000", 1, False
