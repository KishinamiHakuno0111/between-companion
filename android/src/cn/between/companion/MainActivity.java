package cn.between.companion;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.*;
import android.database.Cursor;
import android.database.AbstractWindowedCursor;
import android.database.CursorWindow;
import android.database.sqlite.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.*;
import android.view.inputmethod.*;
import android.webkit.*;
import android.widget.Toast;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public class MainActivity extends Activity {
    private static final String ORIGIN="https://appassets.androidplatform.net";
    private WebView web;
    private SQLiteDatabase database;
    private final ExecutorService workers=Executors.newFixedThreadPool(4);
    private Bridge bridge;
    private boolean pageReady;
    private String pendingCharacter;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest microphoneRequest;
    private String downloadCharacter,downloadId;

    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().setStatusBarColor(Color.rgb(250,248,246));getWindow().setNavigationBarColor(Color.rgb(250,248,246));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        database=openOrCreateDatabase("between.sqlite",MODE_PRIVATE,null);database.setForeignKeyConstraintsEnabled(true);
        web=new WebView(this){
            @Override public InputConnection onCreateInputConnection(EditorInfo info){
                InputConnection original=super.onCreateInputConnection(info);if(original==null)return null;
                info.contentMimeTypes=new String[]{"image/png","image/jpeg","image/webp","image/gif"};
                return new InputConnectionWrapper(original,false){
                    @Override public boolean commitContent(InputContentInfo content,int flags,Bundle opts){
                        try{if((flags&InputConnection.INPUT_CONTENT_GRANT_READ_URI_PERMISSION)!=0)content.requestPermission();
                            pasteUri(content.getContentUri(),()->content.releasePermission());return true;
                        }catch(Exception ignored){return super.commitContent(content,flags,opts);}
                    }
                };
            }
        };
        web.setBackgroundColor(Color.rgb(250,248,246));
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);
        bridge=new Bridge();web.addJavascriptInterface(bridge,"BetweenNative");
        pendingCharacter=getIntent().getStringExtra("characterId");
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return resource(request.getUrl());}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if(isInternal(uri)){if(uri.getPath().startsWith("/api/")){saveAttachment(uri);return true;}return !uri.getPath().equals("/");}
                if("https".equals(uri.getScheme())||"http".equals(uri.getScheme())){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){toast("没有可打开链接的浏览器");}}return true;
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())toast("页面加载失败，请重新打开应用。");}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onPermissionRequest(PermissionRequest request){runOnUiThread(()->{
                if(!isInternal(request.getOrigin())||!Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)){request.deny();return;}
                if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED){request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});return;}
                if(microphoneRequest!=null){request.deny();return;}microphoneRequest=request;
                requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO},21);
            });}
            @Override public void onPermissionRequestCanceled(PermissionRequest request){if(microphoneRequest==request)microphoneRequest=null;}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                try{startActivityForResult(intent,11);}catch(Exception error){fileCallback.onReceiveValue(null);fileCallback=null;toast("无法打开系统文件选择器");}return true;
            }
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;}
        });
        web.setDownloadListener((url,userAgent,disposition,mime,length)->saveAttachment(Uri.parse(url)));
        setContentView(web);web.loadUrl(ORIGIN+"/");
    }
    private boolean isInternal(Uri uri){return "https".equals(uri.getScheme())&&"appassets.androidplatform.net".equals(uri.getHost());}
    private void toast(String message){runOnUiThread(()->Toast.makeText(this,message,Toast.LENGTH_LONG).show());}
    private void js(String code){runOnUiThread(()->{if(web!=null)web.evaluateJavascript(code,null);});}
    private static byte[] utf8(String value){return value.getBytes(StandardCharsets.UTF_8);}
    private Cursor query(String sql,String[] params){
        Cursor cursor=database.rawQuery(sql,params);
        if((sql.toLowerCase(Locale.ROOT).contains("attachments")||sql.toLowerCase(Locale.ROOT).contains("messages"))&&cursor instanceof AbstractWindowedCursor)((AbstractWindowedCursor)cursor).setWindow(new CursorWindow("between-content",32L*1024*1024));
        return cursor;
    }
    private static WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(utf8("Forbidden")));}
    private WebResourceResponse resource(Uri uri){
        if(!isInternal(uri))return blocked();
        String path=uri.getPath();
        try{
            if(path.startsWith("/api/characters/")){
                List<String> parts=uri.getPathSegments();if(parts.size()!=5||!parts.get(3).equals("attachments"))return blocked();
                try(Cursor c=query("SELECT value,bytes FROM attachments WHERE character_id=? AND id=?",new String[]{parts.get(2),parts.get(4)})){
                    if(!c.moveToFirst())return blocked();JSONObject meta=new JSONObject(c.getString(0));
                    Map<String,String> headers=new HashMap<>();headers.put("X-Content-Type-Options","nosniff");headers.put("Cache-Control","no-store");
                    headers.put("Content-Disposition",(meta.getString("kind").equals("image")?"inline":"attachment")+"; filename*=UTF-8''"+Uri.encode(meta.getString("name")));
                    return new WebResourceResponse(meta.getString("mime"),null,200,"OK",headers,new ByteArrayInputStream(c.getBlob(1)));
                }
            }
            String name=path.equals("/")?"index.html":path.substring(1);
            if(!Arrays.asList("index.html","runtime.js","style.css").contains(name))return blocked();
            Map<String,String> headers=new HashMap<>();headers.put("X-Content-Type-Options","nosniff");
            headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'");
            return new WebResourceResponse(name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"text/html","UTF-8",200,"OK",headers,getAssets().open(name));
        }catch(Exception error){return blocked();}
    }
    private void openPendingCharacter(){if(pageReady&&pendingCharacter!=null){String id=pendingCharacter;pendingCharacter=null;js("window.__betweenOpenCharacter("+JSONObject.quote(id)+")");}}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);pendingCharacter=intent.getStringExtra("characterId");openPendingCharacter();}
    @Override public void onBackPressed(){js("window.__betweenBack ? window.__betweenBack() : BetweenNative.minimize()");}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){
        super.onRequestPermissionsResult(request,permissions,results);
        if(request==21&&microphoneRequest!=null){PermissionRequest pending=microphoneRequest;microphoneRequest=null;
            if(results.length>0&&results[0]==android.content.pm.PackageManager.PERMISSION_GRANTED)pending.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else pending.deny();}
    }
    @Override protected void onDestroy(){
        if(bridge!=null)bridge.close();workers.shutdownNow();
        if(fileCallback!=null)fileCallback.onReceiveValue(null);
        if(microphoneRequest!=null){microphoneRequest.deny();microphoneRequest=null;}
        if(web!=null){web.removeJavascriptInterface("BetweenNative");web.destroy();web=null;}
        if(database!=null)database.close();super.onDestroy();
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==11&&fileCallback!=null){
            Uri[] selected=null;
            if(result==RESULT_OK&&data!=null){
                if(data.getClipData()!=null){ClipData clip=data.getClipData();selected=new Uri[clip.getItemCount()];for(int i=0;i<selected.length;i++)selected[i]=clip.getItemAt(i).getUri();}
                else if(data.getData()!=null)selected=new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(selected);fileCallback=null;
        }
        if(request==12&&result==RESULT_OK&&data!=null&&data.getData()!=null){
            final String character=downloadCharacter,id=downloadId;final Uri target=data.getData();
            workers.execute(()->{try(Cursor c=query("SELECT bytes FROM attachments WHERE character_id=? AND id=?",new String[]{character,id})){if(!c.moveToFirst())throw new IOException();try(OutputStream output=getContentResolver().openOutputStream(target)){output.write(c.getBlob(0));}toast("附件已保存");}catch(Exception error){toast("附件保存失败");}});
        }
    }
    private void saveAttachment(Uri uri){
        if(!isInternal(uri))return;List<String> parts=uri.getPathSegments();if(parts.size()!=5||!parts.get(3).equals("attachments"))return;
        runOnUiThread(()->{try(Cursor c=query("SELECT value FROM attachments WHERE character_id=? AND id=?",new String[]{parts.get(2),parts.get(4)})){
            if(!c.moveToFirst())return;JSONObject meta=new JSONObject(c.getString(0));downloadCharacter=parts.get(2);downloadId=parts.get(4);
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(meta.optString("mime","application/octet-stream").split(";")[0]);intent.putExtra(Intent.EXTRA_TITLE,meta.getString("name"));startActivityForResult(intent,12);
        }catch(Exception error){toast("无法保存此附件");}});
    }
    private void pasteUri(Uri uri,Runnable done){
        workers.execute(()->{try{
            String mime=getContentResolver().getType(uri);if(mime==null||!mime.startsWith("image/"))throw new IOException();
            byte[] bytes;try(InputStream input=getContentResolver().openInputStream(uri)){bytes=readLimited(input,20*1024*1024);}
            String extension=mime.equals("image/jpeg")?"jpg":mime.equals("image/webp")?"webp":mime.equals("image/gif")?"gif":"png";
            js("window.__betweenPaste("+JSONObject.quote("粘贴图片-"+System.currentTimeMillis()+"."+extension)+","+JSONObject.quote(mime)+","+JSONObject.quote(Base64.encodeToString(bytes,Base64.NO_WRAP))+")");
        }catch(Exception error){toast("无法粘贴图片，请使用附件按钮选择图片。");}finally{done.run();}});
    }
    private static byte[] readLimited(InputStream input,int limit)throws IOException{
        if(input==null)throw new IOException();ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[16384];int n;
        while((n=input.read(b))!=-1){if(out.size()+n>limit)throw new IOException("File too large");out.write(b,0,n);}return out.toByteArray();
    }
    public class Bridge extends NativeBridge {
        public Bridge(){super(MainActivity.this,MainActivity.this.database,MainActivity.this::js);}
        @JavascriptInterface public void ready(){runOnUiThread(()->{pageReady=true;openPendingCharacter();});}
        @JavascriptInterface public void requestNotifications(){runOnUiThread(()->{if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},22);else startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName()));});}
        @JavascriptInterface public boolean notificationsAllowed(){return getSystemService(android.app.NotificationManager.class).areNotificationsEnabled();}
        @JavascriptInterface public void minimize(){runOnUiThread(()->moveTaskToBack(true));}
        @JavascriptInterface public String sha256(String value){try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(utf8(value));StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format("%02x",b&255));return out.toString();}catch(Exception error){throw new IllegalStateException(error);}}
        @JavascriptInterface public void pasteImage(){runOnUiThread(()->{
            ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);ClipData clip=clipboard.getPrimaryClip();
            if(clip!=null){for(int i=0;i<clip.getItemCount();i++){Uri uri=clip.getItemAt(i).getUri();if(uri!=null&&"content".equals(uri.getScheme())){pasteUri(uri,()->{});return;}}}
            toast("剪贴板没有可读取的图片，可使用附件按钮选择。");
        });}
    }
}
