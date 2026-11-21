Option Explicit

' Verification runs inside Word to avoid hundreds of slow cross-process calls.
Function InspectContinuations(ByVal expectedHeader As String) As String
    On Error GoTo Failed
    Dim doc As Document, tbl As Table, p As Paragraph, prev As Paragraph, following As Paragraph
    Dim firstPage As Long, lastPage As Long, codePage As Long, lastCodePage As Long
    Dim listingNumber As String, headers As String, continuations As String
    Dim prefix As String, listingLabel As String, text As String
    Set doc = ActiveDocument
    prefix = ChrW(1055) & ChrW(1088) & ChrW(1086) & ChrW(1076) & ChrW(1086) & ChrW(1083) & _
        ChrW(1078) & ChrW(1077) & ChrW(1085) & ChrW(1080) & ChrW(1077) & " "
    listingLabel = ChrW(1083) & ChrW(1080) & ChrW(1089) & ChrW(1090) & ChrW(1080) & ChrW(1085) & ChrW(1075) & ChrW(1072)

    For Each tbl In doc.Tables
        CheckContinuation tbl.Rows(1).Range.Text = expectedHeader, "Table header was not copied intact"
        headers = headers & tbl.Rows(1).Range.Text & "|"
        firstPage = tbl.Rows(1).Range.Information(wdActiveEndPageNumber)
        lastPage = tbl.Rows(tbl.Rows.Count).Range.Information(wdActiveEndPageNumber)
        CheckContinuation firstPage = lastPage, "A table fragment still spans pages " & firstPage & ".." & lastPage
        Set prev = tbl.Range.Paragraphs(1).Previous
        CheckContinuation Not prev Is Nothing, "A table has no caption"
        CheckContinuation prev.Style = "Table_Caption" Or prev.Style = "Table_Cont", "A table lost its caption style"
        CheckContinuation InspectStartPage(prev.Range) = firstPage, "Table caption separated from its first row"
    Next tbl

    lastCodePage = -1
    For Each p In doc.Paragraphs
        If Not p.Range.Information(wdWithInTable) Then
            text = Trim$(Replace(p.Range.Text, vbCr, ""))
            If Left$(text, Len(prefix)) = prefix Then
                continuations = continuations & text & "@" & InspectStartPage(p.Range) & "|"
                Set following = p.Next
                CheckContinuation Not following Is Nothing, "Continuation without following content"
                CheckContinuation InspectStartPage(p.Range) = InspectStartPage(following.Range), "Continuation separated from its content"
                CheckContinuation p.KeepWithNext <> 0, "Continuation does not keep with its content"
                If InStr(text, prefix & listingLabel) = 1 Then
                    CheckContinuation ExtractListingNumber(text) = listingNumber, "Incorrect listing number in continuation"
                    CheckContinuation following.Style = "Listing_Code", "Listing continuation without code"
                    lastCodePage = -1
                End If
            ElseIf p.Style = "Listing_Caption" Then
                listingNumber = ExtractListingNumber(text)
                lastCodePage = -1
            ElseIf p.Style = "Listing_Code" Then
                codePage = InspectStartPage(p.Range)
                CheckContinuation lastCodePage = -1 Or codePage = lastCodePage, "Missing listing continuation on page " & codePage
                lastCodePage = codePage
            Else
                lastCodePage = -1
            End If
        End If
    Next p

    If Len(continuations) > 0 Then continuations = Left$(continuations, Len(continuations) - 1)
    InspectContinuations = doc.ComputeStatistics(wdStatisticPages) & vbTab & doc.Tables.Count & vbTab & _
        doc.Paragraphs.Count & vbTab & continuations & vbTab & headers
    Exit Function
Failed:
    InspectContinuations = "ERROR" & vbTab & Err.Description
End Function

Private Function InspectStartPage(source As Range) As Long
    Dim probe As Range
    Set probe = source.Duplicate
    probe.Collapse wdCollapseStart
    probe.Select
    InspectStartPage = Selection.Information(wdActiveEndPageNumber)
End Function

Private Sub CheckContinuation(ByVal condition As Boolean, ByVal message As String)
    If Not condition Then Err.Raise vbObjectError + 100, "InspectContinuations", message
End Sub
