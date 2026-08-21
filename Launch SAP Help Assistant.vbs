Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get the folder where this .vbs file lives
scriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
tempLog = objShell.ExpandEnvironmentStrings("%TEMP%") & "\sap_help_assistant.log"

' Show startup notification
objShell.Popup "SAP Help Assistant is starting, please wait...", 4, "SAP Help Assistant", 64

' Kill any existing instance on port 5001
objShell.Run "cmd /c FOR /F ""tokens=5"" %%a IN ('netstat -aon ^| findstr :5001 ^| findstr LISTENING') DO taskkill /F /PID %%a", 0, True

' Kill any existing Joule SSE connector and restart it
objShell.Run "cmd /c FOR /F ""tokens=5"" %%a IN ('netstat -aon ^| findstr :3456 ^| findstr LISTENING') DO taskkill /F /PID %%a", 0, True
objShell.Run "cmd /c set MCP_HTTP_PORT=3456 && node """ & scriptDir & "\index.js"" > ""%TEMP%\sap_help_mcp_sse.log"" 2>&1", 0, False

' Detect Python command (py launcher is most reliable on Windows)
Dim pyCmd
pyCmd = ""
If objShell.Run("cmd /c py --version >nul 2>&1", 0, True) = 0 Then
    pyCmd = "py"
ElseIf objShell.Run("cmd /c python --version >nul 2>&1", 0, True) = 0 Then
    pyCmd = "python"
ElseIf objShell.Run("cmd /c python3 --version >nul 2>&1", 0, True) = 0 Then
    pyCmd = "python3"
End If

If pyCmd = "" Then
    MsgBox "Python not found. Please run setup.bat first.", vbCritical, "Launch Failed"
    WScript.Quit
End If

' Start Flask server silently
objShell.Run "cmd /c " & pyCmd & " """ & scriptDir & "\web-app\app.py"" > """ & tempLog & """ 2>&1", 0, False

' Wait for server to be ready (check every second, up to 30s)
Dim i, ready, objHTTP
ready = False
For i = 1 To 30
    WScript.Sleep 1000
    Set objHTTP = CreateObject("WinHttp.WinHttpRequest.5.1")
    On Error Resume Next
    objHTTP.Open "GET", "http://localhost:5001", False
    objHTTP.Send
    If Err.Number = 0 And objHTTP.Status = 200 Then
        ready = True
        Exit For
    End If
    On Error Resume Next
Next

If ready Then
    objShell.Run "http://localhost:5001"
Else
    MsgBox "SAP Help Assistant failed to start." & vbCrLf & vbCrLf & _
           "Check log: " & tempLog, vbCritical, "Launch Failed"
End If
