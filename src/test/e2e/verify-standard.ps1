param(
    [Parameter(Mandatory=$true)][string]$RawDoc,
    [Parameter(Mandatory=$true)][string]$ProcessedDoc,
    [Parameter(Mandatory=$true)][string]$PDF
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'helpers/word-package.ps1')
$wordCheck = $null
$rawCheck = $null
try {
    $wordCheck = New-Object -ComObject Word.Application
    $wordCheck.Visible = $false
    $wordCheck.DisplayAlerts = 0
    $rawCheck = Open-WordPackage $wordCheck ([IO.Path]::GetFullPath($RawDoc))
    $projectCheck = $rawCheck.GetType().InvokeMember('VBProject',[Reflection.BindingFlags]::GetProperty,$null,$rawCheck,$null)
    # These modules are only the verifier's dependencies in the unsaved raw doc.
    # The already generated product document is opened read-only; no formatting
    # macros are executed against it and no template is changed.
    foreach ($sourceCheck in @('../../../resources/vba/Common.vba','../../../resources/vba/AutoContinuation.bas','LayoutVerifier.bas')) {
        $moduleCheck = $projectCheck.VBComponents.Add(1)
        $moduleCheck.CodeModule.AddFromString([IO.File]::ReadAllText((Join-Path $PSScriptRoot $sourceCheck)))
    }
    $moduleCheck = $projectCheck.VBComponents.Add(1)
    $moduleCheck.CodeModule.AddFromString(@'
Function VerifyExistingOutput(ByVal file As String, ByVal pdf As String) As String
    On Error GoTo Failed
    Dim result As String, checked As Document
    result = CaptureLayoutBaseline()
    If Left$(result, 6) = "ERROR:" Then
        VerifyExistingOutput = result
        Exit Function
    End If
    Set checked = Documents.Open(FileName:=file, ReadOnly:=True, AddToRecentFiles:=False, Visible:=True)
    checked.Activate
    checked.Repaginate
    result = InspectLayout()
    If Left$(result, 6) <> "ERROR:" Then
        checked.ExportAsFixedFormat OutputFileName:=pdf, ExportFormat:=wdExportFormatPDF
    End If
    checked.Close SaveChanges:=False
    VerifyExistingOutput = result
    Exit Function
Failed:
    VerifyExistingOutput = "ERROR: " & Err.Number & ": " & Err.Description
    On Error Resume Next
    If Not checked Is Nothing Then checked.Close SaveChanges:=False
End Function
'@)
    $resultCheck = [string]$wordCheck.Run('VerifyExistingOutput',[string][IO.Path]::GetFullPath($ProcessedDoc),[string][IO.Path]::GetFullPath($PDF))
    if ($resultCheck -like 'ERROR:*') { throw $resultCheck }
    [IO.File]::WriteAllText(([IO.Path]::GetFullPath($ProcessedDoc) + '.layout.txt'), $resultCheck)
    Write-Output ('STANDARD_LAYOUT_OK ' + $resultCheck)
} finally {
    if ($null -ne $rawCheck) { try { $rawCheck.Close(0) } catch {} }
    if ($null -ne $wordCheck) { try { $wordCheck.Quit(0) } catch {} }
}
