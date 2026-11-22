Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "IndustrialGateway.exe", 0, False
WScript.Sleep 1500
WshShell.Run "http://localhost:8000"
