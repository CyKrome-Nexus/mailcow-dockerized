<?php
/*
  Minimal S3-compatible client for Cloudflare R2 (SigV4), used for the
  avatar upload feature. No AWS SDK dependency — R2 exposes a small
  enough subset of the S3 API that a hand-rolled signer is simpler than
  vendoring the full SDK.
*/
class R2Client {
  private $accountId;
  private $accessKeyId;
  private $secretAccessKey;
  private $bucket;
  private $region = 'auto';
  private $service = 's3';

  public function __construct($accountId, $accessKeyId, $secretAccessKey, $bucket) {
    $this->accountId = $accountId;
    $this->accessKeyId = $accessKeyId;
    $this->secretAccessKey = $secretAccessKey;
    $this->bucket = $bucket;
  }

  private function host() {
    return $this->accountId . '.r2.cloudflarestorage.com';
  }

  private function sign($key, $msg) {
    return hash_hmac('sha256', $msg, $key, true);
  }

  private function signingKey($dateStamp) {
    $kDate = $this->sign('AWS4' . $this->secretAccessKey, $dateStamp);
    $kRegion = $this->sign($kDate, $this->region);
    $kService = $this->sign($kRegion, $this->service);
    return $this->sign($kService, 'aws4_request');
  }

  private function request($method, $key, $body = '', $contentType = null) {
    $amzDate = gmdate('Ymd\THis\Z');
    $dateStamp = gmdate('Ymd');
    $host = $this->host();
    $canonicalUri = '/' . rawurlencode($this->bucket) . '/' . implode('/', array_map('rawurlencode', explode('/', $key)));
    $payloadHash = hash('sha256', $body);

    $canonicalHeaders = "host:{$host}\n" .
      "x-amz-content-sha256:{$payloadHash}\n" .
      "x-amz-date:{$amzDate}\n";
    $signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    $canonicalRequest = implode("\n", [
      $method,
      $canonicalUri,
      '',
      $canonicalHeaders,
      $signedHeaders,
      $payloadHash
    ]);

    $credentialScope = "{$dateStamp}/{$this->region}/{$this->service}/aws4_request";
    $stringToSign = implode("\n", [
      'AWS4-HMAC-SHA256',
      $amzDate,
      $credentialScope,
      hash('sha256', $canonicalRequest)
    ]);

    $signature = bin2hex($this->sign($this->signingKey($dateStamp), $stringToSign));

    $authorization = "AWS4-HMAC-SHA256 Credential={$this->accessKeyId}/{$credentialScope}, SignedHeaders={$signedHeaders}, Signature={$signature}";

    $headers = [
      'Host: ' . $host,
      'x-amz-content-sha256: ' . $payloadHash,
      'x-amz-date: ' . $amzDate,
      'Authorization: ' . $authorization,
    ];
    if ($contentType !== null) {
      $headers[] = 'Content-Type: ' . $contentType;
    }

    $ch = curl_init('https://' . $host . $canonicalUri);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    if ($method === 'PUT') {
      curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
      throw new Exception('R2 request failed: ' . $error);
    }
    if ($status >= 300) {
      throw new Exception('R2 request returned HTTP ' . $status . ': ' . $response);
    }
    return true;
  }

  public function putObject($key, $body, $contentType) {
    return $this->request('PUT', $key, $body, $contentType);
  }

  public function deleteObject($key) {
    return $this->request('DELETE', $key);
  }
}
