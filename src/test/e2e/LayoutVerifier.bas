Option Explicit

Private headers As Object, numbers As Object
Private originalMarkers As String
Private originalPictures As Long

Function CaptureLayoutBaseline() As String
    On Error GoTo Failed
    Dim tbl As Table, before As Paragraph, id As String
    Set headers = CreateObject("Scripting.Dictionary")
    Set numbers = CreateObject("Scripting.Dictionary")
    originalMarkers = MarkerStream(ActiveDocument.Content.Text)
    originalPictures = ActiveDocument.InlineShapes.Count
    For Each tbl In ActiveDocument.Tables
        Set before = tbl.Range.Paragraphs(1).Previous
        If Not before Is Nothing Then
            If before.Style = "Table_Caption" Then
                id = TableId(tbl)
                Require id <> "", "Captioned test table has no row markers"
                Require Not headers.Exists(id), "Duplicate original table id: " & id
                headers.Add id, tbl.Rows(1).Range.Text
                numbers.Add id, ExtractTableNumber(before.Range.Text)
            End If
        End If
    Next tbl
    CaptureLayoutBaseline = "OK"
    Exit Function
Failed:
    CaptureLayoutBaseline = "ERROR: " & Err.Description
End Function

Function InspectLayout() As String
    On Error GoTo Failed
    Dim tbl As Table, before As Paragraph, p As Paragraph, following As Paragraph
    Dim id As String, text As String, prefix As String, listingWord As String
    Dim firstPage As Long, lastPage As Long, page As Long, previousCodePage As Long
    Dim number As String, continuations As String, fragments As String, captioned As Long
    Dim section As Section, hf As HeaderFooter

    Require Not headers Is Nothing, "No baseline captured"
    Require MarkerStream(ActiveDocument.Content.Text) = originalMarkers, "Data markers lost, duplicated or reordered"
    Require ActiveDocument.InlineShapes.Count = originalPictures, "Pictures lost or duplicated"
    For Each tbl In ActiveDocument.Tables
        CheckTableWidth tbl, tbl.Range.Sections(1)
        Set before = tbl.Range.Paragraphs(1).Previous
        If Not before Is Nothing Then
            If before.Style = "Table_Caption" Or before.Style = "Table_Cont" Then
                id = TableId(tbl)
                Require headers.Exists(id), "Unknown/header-only table fragment: " & id
                Require tbl.Rows(1).Range.Text = headers(id), "Wrong header in table " & id
                Require ExtractTableNumber(before.Range.Text) = numbers(id), "Wrong table continuation number: " & id
                firstPage = StartPage(tbl.Rows(1).Range)
                lastPage = EndPage(tbl.Rows(tbl.Rows.Count).Range)
                Require firstPage = lastPage, "Table " & id & " spans pages " & firstPage & ".." & lastPage
                Require StartPage(before.Range) = firstPage, "Detached table caption: " & id
                captioned = captioned + 1
                fragments = fragments & id & ":" & tbl.Rows.Count & "@" & firstPage & "|"
            End If
        End If
    Next tbl
    For Each section In ActiveDocument.Sections
        For Each hf In section.Headers
            For Each tbl In hf.Range.Tables
                CheckTableWidth tbl, section
            Next tbl
        Next hf
        For Each hf In section.Footers
            For Each tbl In hf.Range.Tables
                CheckTableWidth tbl, section
            Next tbl
        Next hf
    Next section

    prefix = ChrW(1055) & ChrW(1088) & ChrW(1086) & ChrW(1076) & ChrW(1086) & ChrW(1083) & _
        ChrW(1078) & ChrW(1077) & ChrW(1085) & ChrW(1080) & ChrW(1077) & " "
    listingWord = ChrW(1083) & ChrW(1080) & ChrW(1089) & ChrW(1090) & ChrW(1080) & ChrW(1085) & ChrW(1075) & ChrW(1072)
    previousCodePage = -1
    For Each p In ActiveDocument.Paragraphs
        If Not p.Range.Information(wdWithInTable) Then
            text = Trim$(Replace(p.Range.Text, vbCr, ""))
            If Left$(text, Len(prefix)) = prefix Then
                Set following = p.Next
                Require Not following Is Nothing, "Continuation without content"
                Require StartPage(p.Range) = StartPage(following.Range), "Detached continuation"
                Require p.KeepWithNext <> 0, "Continuation does not keep with content"
                continuations = continuations & text & "@" & StartPage(p.Range) & "|"
                If InStr(text, prefix & listingWord) = 1 Then
                    Require ExtractListingNumber(text) = number, "Wrong listing continuation number"
                    Require following.Style = "Listing_Code", "Continuation before non-code paragraph"
                    previousCodePage = -1
                End If
            ElseIf p.Style = "Listing_Caption" Then
                number = ExtractListingNumber(text)
                previousCodePage = -1
                Set following = p.Next
                If Not following Is Nothing Then
                    If following.Style = "Listing_Code" Then Require StartPage(p.Range) = StartPage(following.Range), "Detached listing caption"
                End If
            ElseIf p.Style = "Listing_Code" Then
                page = StartPage(p.Range)
                If number <> "" Then
                    Require previousCodePage = -1 Or page = previousCodePage, "Missing listing continuation on page " & page
                    Require EndPage(p.Range) = page, "A code paragraph spans pages without continuation"
                End If
                previousCodePage = page
            Else
                number = ""
                previousCodePage = -1
            End If
        End If
    Next p
    InspectLayout = ActiveDocument.ComputeStatistics(wdStatisticPages) & vbTab & captioned & vbTab & _
        continuations & vbTab & fragments & vbTab & ActiveDocument.Paragraphs.Count & vbTab & originalPictures
    Exit Function
Failed:
    InspectLayout = "ERROR: " & Err.Description
End Function

Private Sub CheckTableWidth(tbl As Table, section As Section)
    Dim cell As Cell, width As Single, available As Single
    For Each cell In tbl.Rows(1).Cells
        width = width + cell.Width
    Next cell
    With section.PageSetup
        available = .PageWidth - .LeftMargin - .RightMargin
    End With
    Require width <= available + 1, "Table exceeds section width: " & Format(width, "0.0") & " > " & Format(available, "0.0")
End Sub

Private Function TableId(tbl As Table) As String
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "([A-Z][A-Z0-9]*)_ROW_[0-9]{3}"
    If re.Test(tbl.Range.Text) Then TableId = re.Execute(tbl.Range.Text)(0).SubMatches(0)
End Function

Private Function MarkerStream(text As String) As String
    Dim re As Object, m As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "[A-Z][A-Z0-9]*_(ROW|LINE|ITEM)_[0-9]{3}"
    re.Global = True
    For Each m In re.Execute(text)
        MarkerStream = MarkerStream & m.Value & "|"
    Next m
End Function

Private Function StartPage(source As Range) As Long
    Dim r As Range
    Set r = source.Duplicate
    r.Collapse wdCollapseStart
    r.Select
    StartPage = Selection.Information(wdActiveEndPageNumber)
End Function

Private Function EndPage(source As Range) As Long
    Dim r As Range
    Set r = source.Duplicate
    If r.End > r.Start Then r.End = r.End - 1
    r.Collapse wdCollapseEnd
    r.Select
    EndPage = Selection.Information(wdActiveEndPageNumber)
End Function

Private Sub Require(ByVal condition As Boolean, ByVal message As String)
    If Not condition Then Err.Raise vbObjectError + 501, "LayoutVerifier", message
End Sub
