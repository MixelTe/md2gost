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
        AlignTableOfContents toc
    Next toc

    ' Поля/оглавление могли изменить длину документа
    ActiveDocument.Repaginate
    DoEvents
End Sub
Private Sub AlignTableOfContents(toc As TableOfContents)
    Dim p As Paragraph, firstWord As Range
    Dim re As Object, matches As Object
    Dim baseIndent As Single, styleTextIndent As Single, textIndent As Single
    Dim entryText As String, prefix As String, hasLabelTab As Boolean
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "^[0-9]+(\.[0-9]+)*\.?[ " & vbTab & ChrW(160) & "]+"
    ' Markdown link settings must not change the automatic TOC's appearance.
    toc.Range.Font.Color = wdColorAutomatic
    toc.Range.Font.Underline = wdUnderlineNone
    For Each p In toc.Range.Paragraphs
        ' Reset direct indents before measuring, so repeated updates are stable.
        With p.Style.ParagraphFormat
            baseIndent = .LeftIndent + .FirstLineIndent
            styleTextIndent = .LeftIndent
        End With
        p.LeftIndent = baseIndent
        p.FirstLineIndent = 0
        entryText = p.Range.Text
        If re.Test(entryText) Then
            Set matches = re.Execute(entryText)
            prefix = matches(0).Value
            hasLabelTab = InStr(prefix, vbTab) > 0 And InStrRev(entryText, vbTab) > Len(prefix)
            Set firstWord = p.Range.Duplicate
            ' Range offsets include hidden field codes; Find locates the visible prefix.
            With firstWord.Find
                .ClearFormatting
                .Text = prefix
                If hasLabelTab Then .Text = Trim$(Replace(Replace(prefix, vbTab, " "), ChrW(160), " "))
                .Forward = True
                .Wrap = wdFindStop
                .Format = False
                .MatchWildcards = False
                .MatchWholeWord = False
            End With
            If firstWord.Find.Execute Then
                firstWord.Collapse wdCollapseEnd
                textIndent = firstWord.Information(wdHorizontalPositionRelativeToTextBoundary)
                If hasLabelTab Then
                    textIndent = textIndent + 4
                    If textIndent < styleTextIndent Then textIndent = styleTextIndent
                    p.TabStops.Add Position:=textIndent, Alignment:=wdAlignTabLeft, Leader:=wdTabLeaderSpaces
                End If
                If textIndent > baseIndent Then
                    p.LeftIndent = textIndent
                    p.FirstLineIndent = baseIndent - textIndent
                End If
            End If
        End If
    Next p
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
