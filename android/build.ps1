$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build command failed: $Program" }
}
$jdkPath = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Java\jdk-25' }
$toolPath = Join-Path $PSScriptRoot 'tools/android-16'
$platformJar = Join-Path $PSScriptRoot 'tools/android-36/android.jar'
if (!(Test-Path -LiteralPath $platformJar)) { throw 'Missing Android SDK. See README.md.' }
New-Item -ItemType Directory -Force build/classes,build/dex,signing,../dist | Out-Null
Invoke-Checked 'node' @('build-web.mjs')
Invoke-Checked "$jdkPath/bin/javac.exe" @('--release','8','-Xlint:-options','-encoding','UTF-8','-classpath',$platformJar,'-d','build/classes','src/cn/between/companion/MainActivity.java')
Invoke-Checked "$jdkPath/bin/jar.exe" @('--create','--file','build/classes.jar','-C','build/classes','.')
Invoke-Checked "$jdkPath/bin/java.exe" @('-cp',"$toolPath/lib/d8.jar",'com.android.tools.r8.D8','--release','--min-api','29','--lib',$platformJar,'--output','build/dex','build/classes.jar')
Invoke-Checked "$toolPath/aapt2.exe" @('compile','--dir','res','-o','build/resources.zip')
Invoke-Checked "$toolPath/aapt2.exe" @('link','-o','build/base.apk','-I',$platformJar,'--manifest','AndroidManifest.xml','-A','build/assets','build/resources.zip','--min-sdk-version','29','--target-sdk-version','35')
Invoke-Checked 'python' @('-c',"import zipfile; z=zipfile.ZipFile('build/base.apk','a'); z.write('build/dex/classes.dex','classes.dex'); z.close()")
Invoke-Checked "$toolPath/zipalign.exe" @('-P','16','-f','4','build/base.apk','build/aligned.apk')
if (!(Test-Path -LiteralPath 'signing/between.jks')) {
    Invoke-Checked 'python' @('-c',"from pathlib import Path; import secrets; Path('signing/password.txt').write_text(secrets.token_hex(32),encoding='ascii')")
    Invoke-Checked "$jdkPath/bin/keytool.exe" @('-genkeypair','-keystore','signing/between.jks','-storetype','JKS','-storepass:file','signing/password.txt','-keypass:file','signing/password.txt','-alias','between','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Between Local App, OU=Personal, O=Between, C=CN')
}
Invoke-Checked "$jdkPath/bin/java.exe" @('-jar',"$toolPath/lib/apksigner.jar",'sign','--ks','signing/between.jks','--ks-key-alias','between','--ks-pass','file:signing/password.txt','--out','../dist/between-0.3.0-android.apk','build/aligned.apk')
Invoke-Checked "$jdkPath/bin/java.exe" @('-jar',"$toolPath/lib/apksigner.jar",'verify','--verbose','../dist/between-0.3.0-android.apk')
Get-FileHash -Algorithm SHA256 -LiteralPath '../dist/between-0.3.0-android.apk' | ForEach-Object { $_.Hash.ToLower() + '  between-0.3.0-android.apk' } | Set-Content -Encoding ascii '../dist/between-0.3.0-android.apk.sha256'
Write-Output 'APK ready: dist/between-0.3.0-android.apk'
