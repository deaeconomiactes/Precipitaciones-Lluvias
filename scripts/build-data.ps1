param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$dataDir = Join-Path $ProjectRoot 'data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

function Normalize-Name([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    $name = ($value.Trim() -replace '\s+', ' ')
    $map = @{
        'Beron de Astrada' = 'Beron de Astrada'
        'Concepcion' = 'Concepcion'
        'Curuzu Cuatia' = 'Curuzu Cuatia'
        'Gral. Alvear' = 'General Alvear'
        'Gral. Paz' = 'General Paz'
        'Itati' = 'Itati'
        'Ituzaingo' = 'Ituzaingo'
        'Mburucuya' = 'Mburucuya'
        'Monte Casero' = 'Monte Caseros'
        'Monte Caseros Mocoreta' = 'Monte Caseros'
        'Paso de los libres' = 'Paso de los Libres'
        'P de los libres' = 'Paso de los Libres'
        'San Martin' = 'San Martin'
        'Santo Tome' = 'Santo Tome'
    }
    if ($map.ContainsKey($name)) { return $map[$name] }
    return $name
}

function As-Number($value) {
    if ($null -eq $value -or $value -eq '') { return $null }
    if ($value -is [double] -or $value -is [int] -or $value -is [decimal]) {
        return [Math]::Round([double]$value, 2)
    }
    $text = ([string]$value).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    if ($text -match ',' -and $text -match '\.') {
        $text = $text -replace '\.', ''
        $text = $text -replace ',', '.'
    } elseif ($text -match ',') {
        $text = $text -replace ',', '.'
    }
    $number = 0.0
    if ([double]::TryParse($text, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
        return [Math]::Round($number, 2)
    }
    return $null
}

function As-ExcelNumber($value) {
    if ($null -eq $value -or $value -eq '') { return $null }
    if ($value -is [double] -or $value -is [int] -or $value -is [decimal]) {
        return [Math]::Round([double]$value, 2)
    }
    return $null
}

function Parse-Date($value) {
    if ($null -eq $value -or $value -eq '') { return $null }
    if ($value -is [double] -or $value -is [int]) {
        if ([double]$value -gt 20000 -and [double]$value -lt 80000) {
            try { return [DateTime]::FromOADate([double]$value) } catch { return $null }
        }
        $value = [string][long]$value
    }
    $text = ([string]$value).Trim()
    foreach ($format in @('yyyyMMdd', 'd/M/yyyy', 'dd/MM/yyyy', 'M/d/yyyy', 'yyyy-MM-dd')) {
        $parsed = [DateTime]::MinValue
        if ([DateTime]::TryParseExact($text, $format, [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::None, [ref]$parsed)) { return $parsed }
    }
    return $null
}

function Save-Json([string]$name, $value) {
    $path = Join-Path $dataDir $name
    $json = $value | ConvertTo-Json -Depth 8 -Compress
    [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
    Write-Host "Creado $path"
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $rainPath = Join-Path $ProjectRoot 'DINAMICA LLUVIAS pruebas.xls'
    $book = $excel.Workbooks.Open($rainPath, 0, $true)
    $sheet = $book.Worksheets.Item('BASE DPTO TOTAL MES')
    $values = $sheet.Range('A2:P2000').Value2
    $rainfall = [Collections.Generic.List[object]]::new()
    $blankStreak = 0
    for ($row = 1; $row -le $values.GetLength(0); $row++) {
        $year = As-Number $values[$row, 1]
        $department = Normalize-Name ([string]$values[$row, 2])
        if ($null -eq $year -or $null -eq $department) {
            $blankStreak++
            if ($blankStreak -ge 20) { break }
            continue
        }
        $blankStreak = 0
        $months = @()
        $sum = 0.0
        $validMonths = 0
        for ($column = 3; $column -le 14; $column++) {
            $number = As-ExcelNumber $values[$row, $column]
            if ($null -eq $number) { $months += $null } else { $months += $number; $sum += $number; $validMonths++ }
        }
        if ($sum -le 0) { continue }
        $rainfall.Add([ordered]@{
            year = [int]$year
            department = $department
            months = $months
            total = [Math]::Round($sum, 2)
            average = [Math]::Round($sum / $validMonths, 2)
        })
    }
    $book.Close($false)

    $gridPath = Join-Path $ProjectRoot 'Grilla Dptos Diferencia mm 05-26.xls'
    $book = $excel.Workbooks.Open($gridPath, 0, $true)
    $sheet = $book.Worksheets.Item('Hoja1')
    $values = $sheet.Range('A3:E100').Value2
    $anomalies = [Collections.Generic.List[object]]::new()
    for ($row = 1; $row -le $values.GetLength(0); $row++) {
        $department = Normalize-Name ([string]$values[$row, 1])
        if ($null -eq $department) { continue }
        $rawPct = $values[$row, 5]
        $pct = if ($null -eq $rawPct) { $null } else { [Math]::Round(([double]$rawPct) * 100, 2) }
        $anomalies.Add([ordered]@{
            department = $department
            historicalAverage = (As-Number $values[$row, 2])
            accumulated = (As-Number $values[$row, 3])
            differenceMm = (As-Number $values[$row, 4])
            differencePct = $pct
        })
    }
    $book.Close($false)

    $stations = [Collections.Generic.List[object]]::new()
    Get-ChildItem (Join-Path $ProjectRoot 'Temperatura') -Filter '*.xls' | ForEach-Object {
        Write-Host "Procesando estacion $($_.Name)"
        $stationName = Normalize-Name ($_.BaseName -replace ' Variables$', '')
        $book = $excel.Workbooks.Open($_.FullName, 0, $true)
        $sheet = @($book.Worksheets) | Where-Object { $_.Name -like 'Datos*' } | Select-Object -First 1
        if ($null -eq $sheet) { $book.Close($false); return }
        $lastRow = [Math]::Min($sheet.UsedRange.Rows.Count, 20000)
        $values = $sheet.Range("A2:E$lastRow").Value2
        $groups = @{}
        $invalidDates = 0
        for ($row = 1; $row -le $values.GetLength(0); $row++) {
            $date = Parse-Date $values[$row, 1]
            if ($null -eq $date) {
                if ($null -ne $values[$row, 1] -and $values[$row, 1] -ne '') { $invalidDates++ }
                continue
            }
            $metrics = @(
                (As-Number $values[$row, 2])
                (As-Number $values[$row, 3])
                (As-Number $values[$row, 4])
                (As-Number $values[$row, 5])
            )
            if (($metrics | Where-Object { $null -ne $_ }).Count -eq 0) { continue }
            $key = '{0:D4}-{1:D2}' -f $date.Year, $date.Month
            if (-not $groups.ContainsKey($key)) {
                $groups[$key] = [ordered]@{ year=$date.Year; month=$date.Month; tempSum=0.0; tempN=0; rhSum=0.0; rhN=0; windSum=0.0; windN=0; rainSum=0.0; rainN=0; days=0 }
            }
            $g = $groups[$key]
            if ($null -ne $metrics[0]) { $g.tempSum += $metrics[0]; $g.tempN++ }
            if ($null -ne $metrics[1]) { $g.rhSum += $metrics[1]; $g.rhN++ }
            if ($null -ne $metrics[2]) { $g.windSum += $metrics[2]; $g.windN++ }
            if ($null -ne $metrics[3]) { $g.rainSum += $metrics[3]; $g.rainN++ }
            $g.days++
        }
        $monthly = @($groups.GetEnumerator() | Sort-Object Name | ForEach-Object {
            $g = $_.Value
            [ordered]@{
                year=$g.year; month=$g.month
                temperature=if($g.tempN){[Math]::Round($g.tempSum/$g.tempN,2)}else{$null}
                humidity=if($g.rhN){[Math]::Round($g.rhSum/$g.rhN,2)}else{$null}
                wind=if($g.windN){[Math]::Round($g.windSum/$g.windN,2)}else{$null}
                rain24Total=if($g.rainN){[Math]::Round($g.rainSum,2)}else{$null}
                days=$g.days
            }
        })
        if ($monthly.Count -gt 0) {
            $stations.Add([ordered]@{ station=$stationName; invalidDates=$invalidDates; monthly=$monthly })
        }
        $book.Close($false)
    }

    $years = @($rainfall | ForEach-Object year | Sort-Object -Unique)
    $departments = @($rainfall | ForEach-Object department | Sort-Object -Unique)
    $metadata = [ordered]@{
        generatedAt = (Get-Date).ToString('s')
        rainfallSource = 'DINAMICA LLUVIAS pruebas.xls'
        anomalySource = 'Grilla Dptos Diferencia mm 05-26.xls'
        rainfallRecords = $rainfall.Count
        departments = $departments
        yearMin = ($years | Measure-Object -Minimum).Minimum
        yearMax = ($years | Measure-Object -Maximum).Maximum
        stations = @($stations | ForEach-Object station)
        floodedHectaresAvailable = $false
    }

    Save-Json 'rainfall.json' @($rainfall)
    Save-Json 'anomalies.json' @($anomalies)
    Save-Json 'stations.json' @($stations)
    Save-Json 'metadata.json' $metadata
}
finally {
    $excel.Quit()
    [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
