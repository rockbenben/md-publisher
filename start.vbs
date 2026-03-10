' md-publisher GUI Launcher (Windows - hidden terminal)
' Double-click this file to start the GUI silently.
' Errors are logged to md-publisher.log

Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strPath

' Check if node is available
Dim exitCode
exitCode = WshShell.Run("cmd /c where node >nul 2>&1", 0, True)
If exitCode <> 0 Then
  MsgBox "Node.js not found! Please install Node.js: https://nodejs.org/", vbCritical, "md-publisher"
  WScript.Quit 1
End If

' Auto-install dependencies if needed
If Not fso.FolderExists(strPath & "\node_modules") Then
  exitCode = WshShell.Run("cmd /c npm install --no-fund --no-audit", 1, True)
  If exitCode <> 0 Then
    MsgBox "Failed to install dependencies. Please run 'npm install' manually.", vbCritical, "md-publisher"
    WScript.Quit 1
  End If
  exitCode = WshShell.Run("cmd /c npx playwright install chromium", 1, True)
  If exitCode <> 0 Then
    MsgBox "Failed to install browser. Please run 'npx playwright install chromium' manually.", vbCritical, "md-publisher"
    WScript.Quit 1
  End If
End If

WshShell.Run "cmd /c node src/gui.js >> md-publisher.log 2>&1", 0, False
