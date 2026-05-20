param (
    [string]$InputDoc,
    [string]$OutputDoc,
    [string]$MacroTemplate,
    [switch]$RenderPDF
)


if (-not $InputDoc) { throw "The input file is not defined" }
if (-not $OutputDoc) { throw "The output file is not defined" }
if (-not $MacroTemplate) { throw "The macro template file is not defined" }

# --- Проверки --------------------------------------------------

if (-not (Test-Path $InputDoc)) {
    throw "The input file was not found: $InputDoc"
}
if (-not (Test-Path $MacroTemplate)) {
    throw "The macro file was not found: $MacroTemplate"
}

$InputDoc = [System.IO.Path]::GetFullPath($InputDoc)
$OutputDoc = [System.IO.Path]::GetFullPath($OutputDoc)
$MacroTemplate = [System.IO.Path]::GetFullPath($MacroTemplate)

# --- Word ------------------------------------------------------

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    # Подключаем глобальный шаблон
    $word.AddIns.Add($MacroTemplate, $true)

    $doc = $word.Documents.Open($InputDoc)

    # --- Generating -------------------------------------------
    Write-Host "[*1] Generating continued listings..."
    $word.Run("AutoListingContinuation")

    Write-Host "[*2] Generating continued tables..."
    $word.Run("AutoTableContinuation")

    # --- Saving -----------------------------------------------
    $doc.SaveAs($OutputDoc, 16)

    if ($RenderPDF) {
        Write-Host "[*3] Render to PDF..."
        $word.Run("RenderSegmentsToPDF")
    }

    $doc.Close($false)
	Write-Host "Done: $OutputDoc"
}
finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
