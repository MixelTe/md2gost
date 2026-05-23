Option Explicit
Private TimerStartTime As Double

Sub UpdateAllFields()
    ' ActiveDocument.Repaginate
    ' DoEvents
    Options.Pagination = True
    ActiveDocument.ComputeStatistics(wdStatisticPages)

    Dim rngStory As Range
    Dim rng As Range

    For Each rngStory In ActiveDocument.StoryRanges
        Set rng = rngStory
        Do
            rng.Fields.Update
            Set rng = rng.NextStoryRange
        Loop Until rng Is Nothing
    Next rngStory

    ' Update the Table of Contents specifically (Fields.Update handles most, but this is a failsafe)
    Dim toc As TableOfContents

    On Error Resume Next
    For Each toc In ActiveDocument.TablesOfContents
        toc.Update
    Next toc
    On Error GoTo 0
End Sub
Sub LogError(msg As String)
    Dim fso As Object, logFile As Object
    Dim outDir As String: outDir = ActiveDocument.Path & "\.md2gost_out\"
    If Dir(outDir, vbDirectory) = "" Then MkDir outDir
    Dim logPath As String: logPath = outDir & "\error.txt"

    AppendLogUTF8 logPath, msg
    ' Set fso = CreateObject("Scripting.FileSystemObject")
    ' Set logFile = fso.OpenTextFile(logPath, 8, True) ' 8 = ForAppending
    ' logFile.WriteLine msg
    ' logFile.Close
End Sub
Sub AppendLogUTF8(logPath As String, msg As String)
    Dim ADOStream As Object
    Set ADOStream = CreateObject("ADODB.Stream")

    With ADOStream
        .Type = 2 ' adTypeText
        .Charset = "utf-8"
        .Open

        ' Если файл уже существует, загружаем его содержимое, чтобы дописать в конец
        Dim fso As Object
        Set fso = CreateObject("Scripting.FileSystemObject")
        If fso.FileExists(logPath) Then
            .LoadFromFile logPath
            .Position = .Size ' Переходим в конец потока
        End If

        ' Записываем новую строку
        .WriteText msg & vbCrLf

        ' Сохраняем обратно в файл
        Const adSaveCreateOverWrite = 2
        .SaveToFile logPath, adSaveCreateOverWrite
        .Close
    End With
End Sub
Sub StartTimer()
    TimerStartTime = Timer
End Sub
Sub EndTimer()
    MsgBox "Code took " & Format(Timer - TimerStartTime, "0.00") & " seconds to run.", vbInformation
End Sub
