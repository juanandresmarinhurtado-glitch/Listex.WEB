$url = 'https://listex.odoo.com/web/content/16027/api_catalogo_listex.json'
try {
    $data = Invoke-RestMethod -Uri $url
    $total = $data.Count
    $nullIds = $data | Where-Object { $_.id_producto -eq $null -or $_.id_producto -eq "" -or $_.id_producto -eq 0 }
    
    Write-Host "Total products: $total"
    if ($nullIds) {
        Write-Host "Found $($nullIds.Count) products with missing/invalid id_producto"
        $nullIds | Select-Object -First 5 | ConvertTo-Json
    } else {
        Write-Host "All products have a valid id_producto."
    }
} catch {
    Write-Error "Failed to fetch JSON: $_"
}
