Option Explicit
Private TimerStartTime As Double

Sub UpdateAllFields()
    Dim rngStory As Range
    Dim rng As Range
    Dim toc As TableOfContents

    ' Режим "Разметка страницы"
    If ActiveWindow.View.Type <> wdPrintView Then
        ActiveWindow.View.Type = wdPrintView
    End If

    ' Принудительно пересчитать разбиение на страницы
    ActiveDocument.Repaginate
    DoEvents

    Options.Pagination = True
    ActiveDocument.ComputeStatistics(wdStatisticPages)

    ' Обновить все поля
    For Each rngStory In ActiveDocument.StoryRanges
        Set rng = rngStory

        Do While Not rng Is Nothing
            rng.Fields.Update
            Set rng = rng.NextStoryRange
        Loop
    Next rngStory

    ' Обновить оглавление
    For Each toc In ActiveDocument.TablesOfContents
        toc.Update
    Next toc

    ' Поля/оглавление могли изменить длину документа
    ActiveDocument.Repaginate
    DoEvents
End Sub
Sub LogError(msg As String)
    Dim fso As Object
    Dim outDir As String
    Dim logPath As String

    Set fso = CreateObject("Scripting.FileSystemObject")

    ' Output directory (Unicode-safe path handling)
    outDir = fso.BuildPath(ActiveDocument.Path, ".md2gost_out")

    If Not fso.FolderExists(outDir) Then
        fso.CreateFolder outDir
    End If

    logPath = fso.BuildPath(outDir, "error.txt")

    AppendLogUTF8 logPath, msg
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
