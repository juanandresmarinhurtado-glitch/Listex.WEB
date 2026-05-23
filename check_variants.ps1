$url = 'https://listex.odoo.com/web/content/16027/api_catalogo_listex.json'
$data = Invoke-RestMethod -Uri $url
$grouped = $data | Group-Object nombre | Where-Object { $_.Count -gt 1 } | Select-Object -First 2
foreach ($g in $grouped) {
    Write-Host "--- $($g.Name) ---"
    $g.Group | Select-Object id_producto, variantes | ConvertTo-Json -Depth 10
}
