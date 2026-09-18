Option Explicit

Sub RenderSegmentsToPDF()
    On Error GoTo ErrorHandler

    Dim mainDoc As Document
    Set mainDoc = ActiveDocument

    Dim fso As Object
    Dim outDir As String

    Set fso = CreateObject("Scripting.FileSystemObject")
    ' Unicode-safe output directory
    outDir = fso.BuildPath(mainDoc.Path, ".md2gost_out")
    If Not fso.FolderExists(outDir) Then
        fso.CreateFolder outDir
    End If

    Dim segIndex As Long
    segIndex = 1

    Dim p As Paragraph
    Dim startRange As Range
    Set startRange = mainDoc.Range(0, 0)

    UpdateAllFields
    mainDoc.Repaginate

    For Each p In mainDoc.Paragraphs
        Dim includeData As Object
        Set includeData = ParseIncludeSyntax(p.Range.Text)

        If Not includeData Is Nothing Then
            ' Export text before include
            If ExportPagesAsPDF(mainDoc, startRange.Start, p.Range.Start - 1, outDir, segIndex) Then
                segIndex = segIndex + 1
            End If

            ' Export included file
            RenderIncludeToPDF includeData, outDir, segIndex
            segIndex = segIndex + 1

            Dim newStart As Long
            newStart = SkipTrailingSectionBreaks(mainDoc, p.Range.End)

            Set startRange = mainDoc.Range(newStart, newStart)
        End If
    Next p

    ' Export trailing content
    If startRange.End < mainDoc.Content.End Then
        ExportPagesAsPDF mainDoc, startRange.Start, mainDoc.Content.End, outDir, segIndex
    End If

    Exit Sub
ErrorHandler:
    LogError "Error #" & Err.Number & ": " & Err.Description
End Sub
Function ParseIncludeSyntax(txt As String) As Object
    On Error GoTo Fail

    Static re As Object
    If re Is Nothing Then
        Set re = CreateObject("VBScript.RegExp")
        re.Pattern = "^\s*!!\((.*?)\)\s*(\{.*\})\s*$"
        re.Global = False
    End If

    Dim result As Object
    Set result = CreateObject("Scripting.Dictionary")

    ' Remove paragraph endings
    txt = Replace(txt, vbCrLf, "")
    txt = Replace(txt, vbLf, "")
    txt = Replace(txt, vbCr, "")
    txt = Trim(txt)

    If re.Test(txt) Then
        Dim m As Object
        Set m = re.Execute(txt)(0)
        result("path") = m.SubMatches(0)
        Set result("fields") = ParseJsonFields(m.SubMatches(1))
        Set ParseIncludeSyntax = result
    Else
        Set ParseIncludeSyntax = Nothing
    End If

    Exit Function

Fail:
    Set ParseIncludeSyntax = Nothing
End Function
Function ParseJsonFields(json As String) As Object
    Dim dict As Object
    Set dict = CreateObject("Scripting.Dictionary")

    Static re As Object
    If re Is Nothing Then
        Set re = CreateObject("VBScript.RegExp")
        re.Pattern = """([^""]+)""\s*:\s*""((?:[^""\\]|\\.)*)"""
        re.Global = True
    End If

    Dim matches As Object
    Dim m As Object
    Dim value As String

    Set matches = re.Execute(json)

    For Each m In matches
        value = m.SubMatches(1)

        ' Unescape simple JSON string escapes
        If InStr(value, "\") > 0 Then
            value = Replace(value, "\""", """")
            value = Replace(value, "\\", "\")
        End If

        dict(m.SubMatches(0)) = value
    Next m

    Set ParseJsonFields = dict
End Function
Function SkipTrailingSectionBreaks(doc As Document, pos As Long) As Long
    Dim docEnd As Long
    docEnd = doc.Content.End - 1
    If docEnd < 0 Then docEnd = 0

    If pos < 0 Then pos = 0
    If pos > docEnd Then pos = docEnd

    Dim r As Range
    Set r = doc.Range(pos, pos)

    Do While r.End < doc.Content.End
        If r.MoveEnd(wdCharacter, 1) = 0 Then Exit Do

        If r.Text = Chr(12) Then
            ' Move past section/page break
            r.Collapse wdCollapseEnd
            pos = r.End
        Else
            Exit Do
        End If
    Loop

    If pos > docEnd Then pos = docEnd

    SkipTrailingSectionBreaks = pos
End Function
Function ExportPagesAsPDF(srcDoc As Document, startPos As Long, endPos As Long, _
                          outDir As String, index As Long) As Boolean
    On Error GoTo ErrorHandler

    If endPos >= srcDoc.Content.End Then
        endPos = srcDoc.Content.End - 1
    End If

    If startPos >= endPos Then
        ExportPagesAsPDF = False
        Exit Function
    End If

    Dim fromPage As Long
    Dim toPage As Long

    fromPage = srcDoc.Range(startPos,startPos).Information(wdActiveEndPageNumber)
    toPage = srcDoc.Range(endPos,endPos).Information(wdActiveEndPageNumber)

    Dim fso As Object
    Dim pdfPath As String

    Set fso = CreateObject("Scripting.FileSystemObject")

    ' Unicode-safe PDF path
    pdfPath = fso.BuildPath(outDir, Format(index, "000") & "-main.pdf")

    srcDoc.ExportAsFixedFormat _
        OutputFileName:=pdfPath, _
        ExportFormat:=wdExportFormatPDF, _
        OptimizeFor:=wdExportOptimizeForPrint, _
        CreateBookmarks:=wdExportCreateHeadingBookmarks, _
        Range:=wdExportFromTo, _
        From:=fromPage, _
        To:=toPage

    ExportPagesAsPDF = True
    Exit Function

ErrorHandler:
    ExportPagesAsPDF = False

    LogError _
        "Error #" & Err.Number & _
        " exporting main document: " & _
        Err.Description
End Function
Sub RenderIncludeToPDF(info As Object, outDir As String, index As Long)
    On Error GoTo Cleanup

    Dim fso As Object
    Dim pdfPath As String
    Dim sourcePath As String

    Set fso = CreateObject("Scripting.FileSystemObject")

    sourcePath = CStr(info("path"))

    ' Include path is expected to be absolute
    If LCase$(Right$(sourcePath, 4)) = ".pdf" Then
        pdfPath = fso.BuildPath(outDir, Format(index, "000") & "-pdf.pdf")

        If fso.FileExists(sourcePath) Then
            ' Copy source PDF into output directory (True allows overwriting)
            fso.CopyFile sourcePath, pdfPath, True
        Else
            LogError "Include PDF not found: " & sourcePath
        End If
    Else
        pdfPath = fso.BuildPath(outDir, Format(index, "000") & "-include.pdf")

        Dim doc As Document
        Set doc = Documents.Open(FileName:=sourcePath, ReadOnly:=True, Visible:=False)

        Dim k As Variant
        For Each k In info("fields").Keys
            ReplaceAll doc, "{{" & CStr(k) & "}}", CStr(info("fields")(k))
        Next k

        doc.ExportAsFixedFormat _
            OutputFileName:=pdfPath, _
            ExportFormat:=wdExportFormatPDF, _
            OptimizeFor:=wdExportOptimizeForPrint, _
            CreateBookmarks:=wdExportCreateHeadingBookmarks

        doc.Close SaveChanges:=False
        Set doc = Nothing

    End If
    Exit Sub
Cleanup:
    Dim errNum As Long
    Dim errDesc As String

    errNum = Err.Number
    errDesc = Err.Description

    On Error Resume Next

    If Not doc Is Nothing Then
        doc.Close SaveChanges:=False
    End If

    On Error GoTo 0

    If errNum <> 0 Then
        LogError "Error #" & errNum & " rendering include '" & sourcePath & "': " & errDesc
    End If
End Sub
Sub ReplaceAll(doc As Document, findText As String, ByVal replaceText As String)
    With doc.Content.Find
        .ClearFormatting
        .Replacement.ClearFormatting

        .Text = findText
        .Replacement.Text = replaceText

        .Forward = True
        .Wrap = wdFindContinue
        .Format = False
        .MatchWildcards = False

        .Execute Replace:=wdReplaceAll
    End With
End Sub