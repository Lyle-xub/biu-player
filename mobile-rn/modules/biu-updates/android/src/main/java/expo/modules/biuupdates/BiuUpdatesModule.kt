package expo.modules.biuupdates

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.security.MessageDigest

class BiuUpdatesModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)
  private val prefs get() = context.getSharedPreferences("biu-app-update", Context.MODE_PRIVATE)
  private val manager get() = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
  private fun installed() = context.packageManager.getPackageInfo(context.packageName, 0)
  private fun file() = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "biu-updates/update-${prefs.getString("version", "")}.apk")

  override fun definition() = ModuleDefinition {
    Name("BiuUpdates")
    Function("unmetered") {
      !(context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered
    }
    AsyncFunction("status") { status() }
    AsyncFunction("download") { url: String, version: String, hash: String, size: Double, wifiOnly: Boolean ->
      check(version.matches(Regex("[0-9]+\\.[0-9]+\\.[0-9]+")) && hash.matches(Regex("[a-f0-9]{64}"))) { "更新信息无效" }
      val uri = Uri.parse(url)
      check(uri.scheme == "https" && uri.host == "github.com" && uri.path?.startsWith("/Lyle-xub/biu-player/releases/download/") == true && uri.lastPathSegment == "Biu-Player-$version-android-arm64.apk" && uri.query == null) { "更新下载地址无效" }
      check(size > 0 && size <= 512 * 1024 * 1024) { "更新安装包大小无效" }
      val old = prefs.getLong("id", -1)
      if (old >= 0) manager.remove(old)
      file().delete()
      val name = "biu-updates/update-$version.apk"
      val destination = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name)
      destination.parentFile?.mkdirs(); destination.delete()
      val request = DownloadManager.Request(uri).setTitle("Biu Player $version")
        .setDescription("正在下载应用更新")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
        .setAllowedOverMetered(!wifiOnly).setAllowedOverRoaming(false)
        .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, name)
      val id = manager.enqueue(request)
      prefs.edit().putLong("id", id).putString("version", version).putString("hash", hash).putLong("size", size.toLong()).commit()
      status()
    }
    AsyncFunction("install") {
      // The installer receives a private, verified copy, never a mutable external file.
      val ready = File(context.cacheDir, "biu-updates/update.apk")
      ready.parentFile?.mkdirs()
      file().copyTo(ready, overwrite = true)
      verify(ready)
      if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
        context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        "permission"
      } else {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.biuupdates", ready)
        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
        "installer"
      }
    }
  }
  private fun status(): Map<String, Any> {
    val version = prefs.getString("version", "") ?: ""
    val id = prefs.getLong("id", -1)
    if (id < 0) return mapOf("phase" to "idle")
    if (installed().versionName == version) {
      manager.remove(id); file().delete(); File(context.cacheDir, "biu-updates/update.apk").delete(); prefs.edit().clear().commit()
      return mapOf("phase" to "idle")
    }
    manager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
      if (!cursor.moveToFirst()) return mapOf("phase" to "error", "message" to "更新下载已失效，请重新下载", "version" to version)
      val state = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
      if (state == DownloadManager.STATUS_SUCCESSFUL) {
        verify()
        return mapOf("phase" to "ready", "version" to version, "progress" to 100)
      }
      if (state == DownloadManager.STATUS_FAILED) return mapOf("phase" to "error", "version" to version, "message" to "下载失败，请检查网络和可用空间后重试")
      val bytes = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
      val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
      return mapOf("phase" to "downloading", "version" to version, "progress" to if (total > 0) bytes * 100.0 / total else 0,
        "message" to if (state == DownloadManager.STATUS_PAUSED || state == DownloadManager.STATUS_PENDING) "等待网络，连接 Wi-Fi 后继续下载" else "正在下载更新")
    }
  }
  @Suppress("DEPRECATION")
  private fun verify(apk: File = file()) {
    check(apk.isFile && apk.length() == prefs.getLong("size", -1)) { "安装包不完整，请重新下载" }
    val hash = MessageDigest.getInstance("SHA-256")
    apk.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) { val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) }
    }
    check(hash.digest().joinToString("") { "%02x".format(it) } == prefs.getString("hash", "")) { "安装包校验失败，请重新下载" }
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val candidate = context.packageManager.getPackageArchiveInfo(apk.absolutePath, flags)
    val current = context.packageManager.getPackageInfo(context.packageName, flags)
    check(candidate != null && candidate.packageName == context.packageName && candidate.versionName == prefs.getString("version", "")) { "安装包不属于当前应用" }
    val nextCode = if (Build.VERSION.SDK_INT >= 28) candidate.longVersionCode else candidate.versionCode.toLong()
    val currentCode = if (Build.VERSION.SDK_INT >= 28) current.longVersionCode else current.versionCode.toLong()
    check(nextCode > currentCode) { "该安装包不比当前版本新" }
    val expected = if (Build.VERSION.SDK_INT >= 28) current.signingInfo?.apkContentsSigners else current.signatures
    val actual = if (Build.VERSION.SDK_INT >= 28) candidate.signingInfo?.apkContentsSigners else candidate.signatures
    check(!expected.isNullOrEmpty() && !actual.isNullOrEmpty() && expected.size == actual.size && actual.all { signature -> expected.any { it == signature } }) { "安装包签名不匹配，已阻止安装" }
  }
}
