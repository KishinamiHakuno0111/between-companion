import {execFile} from 'node:child_process';

// Data crosses the shell boundary as base64 JSON; message text is never executable PowerShell.
const script=`$ErrorActionPreference='Stop'
$payload=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BETWEEN_NOTIFICATION)) | ConvertFrom-Json
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null
$appId='Between.Companion'
$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\\Classes\\AppUserModelId\\'+$appId)
$key.SetValue('DisplayName','此间'); $key.Close()
$doc=New-Object Windows.Data.Xml.Dom.XmlDocument
$escape={param($s) [System.Security.SecurityElement]::Escape([string]$s)}
$xml='<toast activationType="protocol" launch="'+(& $escape $payload.url)+'"><visual><binding template="ToastGeneric"><text>'+(& $escape $payload.title)+'</text><text>'+(& $escape $payload.content)+'</text></binding></visual></toast>'
$doc.LoadXml($xml)
$toast=[Windows.UI.Notifications.ToastNotification]::new($doc)
$toast.Tag=$payload.tag
$toast.Group='between'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)`;
export function windowsNotifier(getBaseUrl) {
  return async(character,message)=>{
    if(process.platform!=='win32')return;
    const url=new URL(getBaseUrl());url.hash='character='+encodeURIComponent(character.id);
    const data=Buffer.from(JSON.stringify({title:character.name,content:message.content.slice(0,240),url:url.href,tag:message.id.slice(-16)})).toString('base64');
    await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,env:{...process.env,BETWEEN_NOTIFICATION:data}},error=>error?reject(new Error('系统通知未能显示，请检查 Windows 通知设置。')):resolve()));
  };
}
