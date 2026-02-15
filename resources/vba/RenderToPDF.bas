Sub RenderSegmentsToPDF()
    On Error GoTo ErrorHandler

    Dim mainDoc As Document
    Set mainDoc = ActiveDocument

    Dim outDir As String
    outDir = mainDoc.Path & "\.md2gost_out\"

    If Dir(outDir, vbDirectory) = "" Then MkDir outDir

    Dim segIndex As Integer
    segIndex = 1

    Dim p As Paragraph
    Dim startRange As Range
    Set startRange = mainDoc.Range(0, 0)

    UpdateAllFields
    mainDoc.Repaginate

    Dim i As Long
    For i = 1 To mainDoc.Paragraphs.Count
        Set p = mainDoc.Paragraphs(i)

        Dim includeData As Object
        Set includeData = ParseIncludeSyntax(p.Range.Text)

        If Not includeData Is Nothing Then
            ' Export text BEFORE include
            If ExportPagesAsPDF(mainDoc, startRange.Start, p.Range.Start, outDir, segIndex) Then
                segIndex = segIndex + 1
            End If

            ' Export include itself
            RenderIncludeToPDF includeData, outDir, segIndex
            segIndex = segIndex + 1

            ' Set startRange = mainDoc.Range(p.Range.End, p.Range.End)
            Dim newStart As Long
            newStart = SkipTrailingSectionBreaks(mainDoc, p.Range.End)
            Set startRange = mainDoc.Range(newStart, newStart)
        End If
    Next i

    ' Export trailing content
    If startRange.End < mainDoc.Content.End Then
        ExportPagesAsPDF mainDoc, startRange.Start, mainDoc.Content.End, outDir, segIndex
    End If
    ' Selection.SetRange Start:=0, End:=1
    ' Selection.Copy
    Exit Sub
ErrorHandler:
    LogError "Error #" & Err.Number & ": " & Err.Description
End Sub
Function ParseIncludeSyntax(txt As String) As Object
    On Error GoTo Fail

    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "^!!\((.*?)\)\s*(\{.*\})$"
    re.Global = False

    Dim result As Object
    Set result = CreateObject("Scripting.Dictionary")

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

    json = Replace(json, "{", "")
    json = Replace(json, "}", "")
    json = Replace(json, """", "")

    Dim pairs() As String
    pairs = Split(json, ",")

    Dim i As Integer, kv() As String
    For i = 0 To UBound(pairs)
        kv = Split(pairs(i), ":")
        If UBound(kv) = 1 Then
            dict(Trim(kv(0))) = Trim(kv(1))
        End If
    Next i

    Set ParseJsonFields = dict
End Function
Function SkipTrailingSectionBreaks(doc As Document, pos As Long) As Long
    Dim r As Range
    Set r = doc.Range(pos, pos)

    Do While r.End < doc.Content.End
        r.MoveEnd wdCharacter, 1

        ' Chr(12) → section break (next page)
        ' Chr(14) → section break (continuous)
        If r.Text Like Chr(12) Or r.Text Like Chr(14) Then
            pos = r.End
        Else
            Exit Do
        End If
    Loop

    SkipTrailingSectionBreaks = pos
End Function
Function ExportPagesAsPDF(srcDoc As Document, startPos As Long, endPos As Long, _
                          outDir As String, index As Integer) As Boolean
    If endPos >= srcDoc.Content.End Then
        endPos = srcDoc.Content.End - 1
    End If

    If startPos >= endPos Then
        ExportPagesAsPDF = False
        Exit Function
    End If

    Dim fromPage As Long, toPage As Long
    fromPage = srcDoc.Range(startPos, startPos).Information(wdActiveEndPageNumber)
    toPage   = srcDoc.Range(endPos, endPos).Information(wdActiveEndPageNumber)


    Dim pdfPath As String
    pdfPath = outDir & Format(index, "000") & "-main.pdf"

    srcDoc.ExportAsFixedFormat _
        OutputFileName:=pdfPath, _
        ExportFormat:=wdExportFormatPDF, _
        Range:=wdExportFromTo, _
        From:=fromPage, _
        To:=toPage

    ExportPagesAsPDF = True
End Function
Sub RenderIncludeToPDF(info As Object, outDir As String, index As Integer)
    Dim doc As Document
    Set doc = Documents.Open(info("path"), ReadOnly:=True, Visible:=False)

    Dim k As Variant
    For Each k In info("fields").Keys
        ReplaceAll doc, "{{" & k & "}}", info("fields")(k)
    Next k

    Dim pdfPath As String
    pdfPath = outDir & Format(index, "000") & "-include.pdf"

    doc.ExportAsFixedFormat pdfPath, wdExportFormatPDF
    doc.Close False
End Sub
Sub ReplaceAll(doc As Document, findText As String, ByVal replaceText As String)
    With doc.Content.Find
        .Text = findText
        .Replacement.Text = replaceText
        .Forward = True
        .Wrap = wdFindContinue
        .Execute Replace:=wdReplaceAll
    End With
End Sub