$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:8080/")
$listener.Prefixes.Add("http://localhost:8080/")
$listener.Start()
Write-Host "Server started on http://127.0.0.1:8080/"

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $requestUrl = $context.Request.Url.LocalPath
    if ($requestUrl -eq "/") { $requestUrl = "/index.html" }
    
    $ext = [System.IO.Path]::GetExtension($requestUrl).ToLower()
    $mime = "text/plain"
    switch ($ext) {
        ".html" { $mime = "text/html" }
        ".css"  { $mime = "text/css" }
        ".js"   { $mime = "application/javascript" }
        ".jpg"  { $mime = "image/jpeg" }
        ".jpeg" { $mime = "image/jpeg" }
        ".png"  { $mime = "image/png" }
        ".gif"  { $mime = "image/gif" }
        ".svg"  { $mime = "image/svg+xml" }
    }
    
    $filePath = Join-Path "c:\Users\juan\.gemini\antigravity\playground\spatial-aurora" $requestUrl
    
    try {
        if (Test-Path $filePath -PathType Leaf) {
            $context.Response.ContentType = $mime
            
            # CORS Headers to ensure cloudflared tunnel works
            $context.Response.AppendHeader("Access-Control-Allow-Origin", "*")
            
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $context.Response.ContentLength64 = $content.Length
            $context.Response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $context.Response.StatusCode = 404
        }
    } catch {
        $context.Response.StatusCode = 500
    }
    $context.Response.Close()
}
