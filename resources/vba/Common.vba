Sub UpdateAllFields()
    Dim aStory As Range
    Dim aField As Field

    For Each aStory In ActiveDocument.StoryRanges
        aStory.Fields.Update
    Next aStory

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
        .SaveToFile logPath, 2 ' adSaveCreateOverWrite
        .Close
    End With
End Sub
