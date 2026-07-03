Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get the folder where this .vbs file lives
scriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
tempLog = objShell.ExpandEnvironmentStrings("%TEMP%") & "\sap_help_assistant.log"

' Show startup notification
objShell.Popup "SAP Help Assistant is starting, please wait...", 4, "SAP Help Assistant", 64

' Kill any existing instance on port 5001
objShell.Run "cmd /c FOR /F ""tokens=5"" %%a IN ('netstat -aon ^| findstr :5001 ^| findstr LISTENING') DO taskkill /F /PID %%a", 0, True

' Start Flask server silently
objShell.Run "cmd /c python """ & scriptDir & "\web-app\app.py"" > """ & tempLog & """ 2>&1", 0, False

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
