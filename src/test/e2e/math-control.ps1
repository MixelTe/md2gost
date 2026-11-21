param([Parameter(Mandatory=$true)][string]$OutputBase)
$ErrorActionPreference = 'Stop'
$wordControl = $null
$hostControl = $null
try {
    $wordControl = New-Object -ComObject Word.Application
    $wordControl.Visible = $false
    $wordControl.DisplayAlerts = 0
    $hostControl = $wordControl.Documents.Add()
    $projectControl = $hostControl.GetType().InvokeMember('VBProject',[System.Reflection.BindingFlags]::GetProperty,$null,$hostControl,$null)
    $moduleControl = $projectControl.VBComponents.Add(1)
    $moduleControl.CodeModule.AddFromString(@'
Sub NativeMathControl(ByVal target As String)
    Dim doc As Document, r As Range
    Set doc = Documents.Add()
    doc.Range.Text = "a_1^2+x"
    Set r = doc.Range(0, doc.Content.End - 1)
    doc.OMaths.Add r
    doc.OMaths(1).BuildUp
    doc.ExportAsFixedFormat OutputFileName:=target & ".pdf", ExportFormat:=wdExportFormatPDF
    doc.ExportAsFixedFormat OutputFileName:=target & "-pdfa.pdf", ExportFormat:=wdExportFormatPDF, UseISO19005_1:=True
    doc.SaveAs FileName:=target & ".docx", FileFormat:=wdFormatXMLDocument
    doc.Close SaveChanges:=False
End Sub
'@)
    $wordControl.Run('NativeMathControl',[string]$OutputBase) | Out-Null
    Write-Output 'MATH_CONTROL_EXPORTED'
} finally {
    if ($null -ne $hostControl) { try { $hostControl.Close(0) } catch {} }
    if ($null -ne $wordControl) { try { $wordControl.Quit(0) } catch {} }
}
