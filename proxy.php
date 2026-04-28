<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

// Responde preflight (CORS)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if (!isset($_GET['url'])) {
    http_response_code(400);
    echo json_encode(["error" => "URL não fornecida"]);
    exit;
}

$url = $_GET['url'];

// 🔒 (Opcional) Proteção básica - permite só domínios específicos
$allowed = [
    "fonteblack.sbs",
];

$host = parse_url($url, PHP_URL_HOST);

if (!in_array($host, $allowed)) {
    http_response_code(403);
    echo json_encode(["error" => "Domínio não permitido"]);
    exit;
}

// 🔁 Requisição
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);

// Simula navegador (evita bloqueio IPTV)
curl_setopt($ch, CURLOPT_USERAGENT, $_SERVER['HTTP_USER_AGENT']);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);

curl_close($ch);

// Define content-type correto
if ($contentType) {
    header("Content-Type: " . $contentType);
}

http_response_code($httpCode);
echo $response;