<?php
/*
  Self-service mailbox avatar upload.
  Only the logged-in mailbox owner may change their own avatar — no
  admin/domain-admin override path exists here by design.
*/
require_once $_SERVER['DOCUMENT_ROOT'] . '/inc/prerequisites.inc.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/inc/lib/R2Client.php';
header('Content-Type: application/json');

function avatar_json($success, $msg = '') {
  echo json_encode(['success' => $success, 'msg' => $msg]);
  exit();
}

if (!isset($_SESSION['mailcow_cc_role']) || $_SESSION['mailcow_cc_role'] !== 'user') {
  http_response_code(403);
  avatar_json(false, 'unauthorized');
}

$username = $_SESSION['mailcow_cc_username'];

global $pdo, $avatar_r2_account_id, $avatar_r2_access_key_id, $avatar_r2_secret_access_key, $avatar_r2_bucket, $avatar_r2_public_domain;

if (empty($avatar_r2_account_id) || empty($avatar_r2_access_key_id) || empty($avatar_r2_secret_access_key) || empty($avatar_r2_bucket)) {
  http_response_code(500);
  avatar_json(false, 'avatar storage is not configured');
}

$avatar_key = 'avatars/' . md5(strtolower($username)) . '.webp';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  avatar_json(false, 'method not allowed');
}

// session_check() (triggered by loading prerequisites.inc.php above) already
// validated $_POST['csrf_token'] for us — nothing further to check here.
$action = $_POST['action'] ?? 'upload';

try {
  $r2 = new R2Client($avatar_r2_account_id, $avatar_r2_access_key_id, $avatar_r2_secret_access_key, $avatar_r2_bucket);

  if ($action === 'remove') {
    $r2->deleteObject($avatar_key);

    $stmt = $pdo->prepare("UPDATE `mailbox` SET `attributes` = JSON_REMOVE(`attributes`, '$.avatar_updated_at') WHERE `username` = :username");
    $stmt->execute(['username' => $username]);

    avatar_json(true);
  }
  elseif ($action === 'upload') {
    if (empty($_FILES['avatar']) || $_FILES['avatar']['error'] !== UPLOAD_ERR_OK) {
      avatar_json(false, 'no file uploaded');
    }

    $tmp_path = $_FILES['avatar']['tmp_name'];
    $size = $_FILES['avatar']['size'];
    if ($size > 5 * 1024 * 1024) {
      avatar_json(false, 'file too large (max 5 MB)');
    }

    $info = @getimagesize($tmp_path);
    if ($info === false) {
      avatar_json(false, 'unsupported or corrupt image');
    }
    $mime = $info['mime'];

    switch ($mime) {
      case 'image/jpeg':
        $src = @imagecreatefromjpeg($tmp_path);
        break;
      case 'image/png':
        $src = @imagecreatefrompng($tmp_path);
        break;
      case 'image/webp':
        $src = @imagecreatefromwebp($tmp_path);
        break;
      default:
        avatar_json(false, 'only JPEG, PNG or WebP images are supported');
    }
    if (!$src) {
      avatar_json(false, 'could not read image');
    }

    // Crop to a centered square, then resize to a fixed avatar size.
    $srcW = imagesx($src);
    $srcH = imagesy($src);
    $cropSize = min($srcW, $srcH);
    $cropX = intdiv($srcW - $cropSize, 2);
    $cropY = intdiv($srcH - $cropSize, 2);

    $target = 512;
    $dst = imagecreatetruecolor($target, $target);
    imagesavealpha($dst, true);
    $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
    imagefill($dst, 0, 0, $transparent);

    imagecopyresampled($dst, $src, 0, 0, $cropX, $cropY, $target, $target, $cropSize, $cropSize);
    imagedestroy($src);

    ob_start();
    imagewebp($dst, null, 82);
    $webp_data = ob_get_clean();
    imagedestroy($dst);

    $r2->putObject($avatar_key, $webp_data, 'image/webp');

    $stmt = $pdo->prepare("UPDATE `mailbox` SET `attributes` = JSON_SET(`attributes`, '$.avatar_updated_at', :ts) WHERE `username` = :username");
    $stmt->execute([
      'ts' => time(),
      'username' => $username
    ]);

    avatar_json(true);
  }
  else {
    avatar_json(false, 'unknown action');
  }
}
catch (Exception $e) {
  http_response_code(502);
  avatar_json(false, 'avatar storage error');
}
