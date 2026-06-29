param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$SourceCsvUrl = $env:DAILY_RAIN_CSV_URL,
    [string]$SourceCsvUrls = $env:DAILY_RAIN_CSV_URLS,
    [string]$SourceCsvPath = $env:DAILY_RAIN_CSV_PATH
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Normalize-Text([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    $text = $value.Trim().ToLowerInvariant()
    $normalized = $text.Normalize([Text.NormalizationForm]::FormD)
    $builder = [Text.StringBuilder]::new()
    foreach ($char in $normalized.ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($char) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$builder.Append($char)
        }
    }
    return ($builder.ToString().Normalize([Text.NormalizationForm]::FormC) -replace '\s+', ' ')
}

function Normalize-Department([string]$value) {
    $key = Normalize-Text $value
    if ($null -eq $key) { return $null }
    $map = @{
        'bella vista' = 'Bella Vista'
        'beron de astrada' = 'Beron de Astrada'
        'capital' = 'Capital'
        'capital corrientes' = 'Capital'
        'concepcion' = 'Concepcion'
        'curuzu cuatia' = 'Curuzu Cuatia'
        'empedrado' = 'Empedrado'
        'esquina' = 'Esquina'
        'general alvear' = 'General Alvear'
        'gral alvear' = 'General Alvear'
        'general paz' = 'General Paz'
        'goya' = 'Goya'
        'itati' = 'Itati'
        'ituzaingo' = 'Ituzaingo'
        'lavalle' = 'Lavalle'
        'mburucuya' = 'Mburucuya'
        'mercedes' = 'Mercedes'
        'monte caseros' = 'Monte Caseros'
        'paso de los libres' = 'Paso de los Libres'
        'saladas' = 'Saladas'
        'san cosme' = 'San Cosme'
        'san luis del palmar' = 'San Luis del Palmar'
        'san martin' = 'San Martin'
        'san miguel' = 'San Miguel'
        'san roque' = 'San Roque'
        'santo tome' = 'Santo Tome'
        'sauce' = 'Sauce'
    }
    if ($map.ContainsKey($key)) { return $map[$key] }
    return (Get-Culture).TextInfo.ToTitleCase($key)
}

function Get-RowValue($row, [string[]]$names) {
    foreach ($name in $names) {
        if ($row.PSObject.Properties.Name -contains $name) {
            $value = $row.$name
            if (-not [string]::IsNullOrWhiteSpace([string]$value)) { return $value }
        }
    }
    return $null
}

function Read-CsvRows {
    $urls = @()
    if (-not [string]::IsNullOrWhiteSpace($SourceCsvUrls)) {
        $urls += @($SourceCsvUrls -split '[;\r\n]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    if (-not [string]::IsNullOrWhiteSpace($SourceCsvUrl)) {
        $urls += $SourceCsvUrl
    }

    if ($urls.Count -gt 0) {
        $allRows = @()
        foreach ($url in ($urls | Select-Object -Unique)) {
            Write-Host "Descargando registros diarios desde $url"
            $response = Invoke-WebRequest -Uri $url -MaximumRedirection 5 -TimeoutSec 60
            $allRows += @($response.Content | ConvertFrom-Csv)
        }
        return $allRows
    }

    if ([string]::IsNullOrWhiteSpace($script:SourceCsvPath)) {
        $candidate = Join-Path (Split-Path $ProjectRoot -Parent) 'Registro-de-lluvias\plantilla_registro_lluvias.csv'
        if (Test-Path $candidate) { $script:SourceCsvPath = $candidate }
    }

    if ([string]::IsNullOrWhiteSpace($script:SourceCsvPath) -or -not (Test-Path $script:SourceCsvPath)) {
        throw 'No se encontro una fuente diaria. Defina DAILY_RAIN_CSV_URL o DAILY_RAIN_CSV_PATH.'
    }

    Write-Host "Leyendo registros diarios desde $script:SourceCsvPath"
    return Import-Csv -Path $script:SourceCsvPath
}

function Parse-DateValue($value) {
    $text = [string]$value
    $formats = @('yyyy-MM-dd','dd/MM/yyyy','d/M/yyyy','MM/dd/yyyy')
    $date = [datetime]::MinValue
    foreach ($format in $formats) {
        if ([datetime]::TryParseExact($text, $format, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$date)) {
            return $date.Date
        }
    }
    if ([datetime]::TryParse($text, [ref]$date)) { return $date.Date }
    return $null
}

function Get-RainValue($row) {
    $raw = Get-RowValue $row @('rain','lluvia','precipitacion','precipitacion_mm','precipitacionMm','lluvia_mm','mm')
    $text = ([string]$raw).Trim() -replace ',', '.'
    $value = 0.0
    if ([double]::TryParse($text, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
        return [Math]::Max(0, $value)
    }
    return $null
}

function Get-WindowSum($lookup, [string]$department, [datetime]$endDate, [int]$days) {
    $sum = 0.0
    for ($offset = 0; $offset -lt $days; $offset++) {
        $date = $endDate.AddDays(-$offset).ToString('yyyy-MM-dd')
        $key = "$department|$date"
        if ($lookup.ContainsKey($key)) { $sum += [double]$lookup[$key] }
    }
    return [Math]::Round($sum, 2)
}

function Get-Level([double]$recent, [double]$historical, [double]$pct, [int]$days) {
    $minYellow = if ($days -le 7) { 30 } elseif ($days -le 15) { 45 } else { 70 }
    $minOrange = if ($days -le 7) { 50 } elseif ($days -le 15) { 75 } else { 110 }
    $minRed = if ($days -le 7) { 80 } elseif ($days -le 15) { 120 } else { 160 }

    if ($historical -le 0 -and $recent -le 0) { return 'normal' }
    if ($recent -ge $minRed -and $pct -ge 100) { return 'rojo' }
    if ($recent -ge $minOrange -and $pct -ge 60) { return 'naranja' }
    if ($recent -ge $minYellow -and $pct -ge 30) { return 'amarillo' }
    return 'normal'
}

$rows = Read-CsvRows
$dailyByKey = @{}
$coordsByDepartment = @{}

foreach ($row in $rows) {
    $date = Parse-DateValue (Get-RowValue $row @('date','fecha','Fecha','FECHA'))
    $departmentRaw = Get-RowValue $row @('department','departamento','Departamento','DEPARTAMENTO')
    $department = Normalize-Department $departmentRaw
    $rain = Get-RainValue $row
    if ($null -eq $date -or $null -eq $department -or $null -eq $rain) { continue }

    $key = "$department|$($date.ToString('yyyy-MM-dd'))"
    if (-not $dailyByKey.ContainsKey($key)) { $dailyByKey[$key] = 0.0 }
    $dailyByKey[$key] = [double]$dailyByKey[$key] + [double]$rain

    if (-not $coordsByDepartment.ContainsKey($department)) {
        $lat = 0.0; $lng = 0.0
        $rawLat = Get-RowValue $row @('lat','latitude','latitud')
        $rawLng = Get-RowValue $row @('lng','lon','long','longitude','longitud')
        if ([double]::TryParse(([string]$rawLat), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$lat) -and
            [double]::TryParse(([string]$rawLng), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$lng)) {
            $coordsByDepartment[$department] = @{ lat = $lat; lng = $lng }
        }
    }
}

$records = foreach ($key in $dailyByKey.Keys) {
    $parts = $key -split '\|'
    $coords = if ($coordsByDepartment.ContainsKey($parts[0])) { $coordsByDepartment[$parts[0]] } else { @{ lat = $null; lng = $null } }
    [ordered]@{
        date = $parts[1]
        department = $parts[0]
        rainfallMm = [Math]::Round([double]$dailyByKey[$key], 2)
        lat = $coords.lat
        lng = $coords.lng
    }
}

$records = @($records | Sort-Object date, department)
if ($records.Count -eq 0) { throw 'No se generaron registros diarios validos.' }

$lookup = @{}
foreach ($record in $records) {
    $lookup["$($record.department)|$($record.date)"] = $record.rainfallMm
}

$departments = @($records.department | Sort-Object -Unique)
$dates = @($records.date | Sort-Object -Unique)
$latestDate = [datetime]::ParseExact($dates[-1], 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
$windows = @(1, 7, 15, 30)
$summaryRows = @()

foreach ($days in $windows) {
    foreach ($department in $departments) {
        $recent = Get-WindowSum $lookup $department $latestDate $days
        $historicalValues = @()
        foreach ($year in ($records | Where-Object { $_.department -eq $department } | ForEach-Object { ([datetime]::ParseExact($_.date, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)).Year } | Sort-Object -Unique)) {
            if ($year -ge $latestDate.Year) { continue }
            try {
                $historicalEnd = [datetime]::new($year, $latestDate.Month, $latestDate.Day)
            } catch {
                continue
            }
            $historicalValues += Get-WindowSum $lookup $department $historicalEnd $days
        }
        $historical = if ($historicalValues.Count) { [Math]::Round((($historicalValues | Measure-Object -Average).Average), 2) } else { 0 }
        $difference = [Math]::Round($recent - $historical, 2)
        $pct = if ($historical -gt 0) { [Math]::Round((($recent - $historical) / $historical) * 100, 2) } elseif ($recent -gt 0) { 999 } else { 0 }
        $summaryRows += [ordered]@{
            windowDays = $days
            analysisDate = $latestDate.ToString('yyyy-MM-dd')
            department = $department
            recentMm = $recent
            historicalAverageMm = $historical
            differenceMm = $difference
            differencePct = $pct
            level = Get-Level $recent $historical $pct $days
            historicalYears = $historicalValues.Count
        }
    }
}

$dataDir = Join-Path $ProjectRoot 'data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$jsonOptions = @{ Depth = 8 }
@($records) | ConvertTo-Json @jsonOptions | Set-Content -Encoding UTF8 (Join-Path $dataDir 'rainfall-daily.json')

$summary = [ordered]@{
    generatedAt = (Get-Date).ToString('s')
    source = if ($SourceCsvUrl -or $SourceCsvUrls) { 'Google Sheets CSV configurado' } else { 'Registro-de-lluvias/plantilla_registro_lluvias.csv' }
    dateMin = $dates[0]
    dateMax = $dates[-1]
    records = $records.Count
    departments = $departments
    windows = $windows
    rows = @($summaryRows)
}
$summary | ConvertTo-Json @jsonOptions | Set-Content -Encoding UTF8 (Join-Path $dataDir 'rainfall-daily-summary.json')

Write-Host "Generados rainfall-daily.json ($($records.Count) registros) y rainfall-daily-summary.json."
