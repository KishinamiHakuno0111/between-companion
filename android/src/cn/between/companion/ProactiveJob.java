package cn.between.companion;

import android.app.job.*;
import android.content.*;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** An OS-scheduled, bounded local runtime; no remote server or permanent foreground service. */
public class ProactiveJob extends JobService {
    private static final int ID=4137;
    private static boolean running;
    private WebView web;
    private NativeBridge bridge;
    private SQLiteDatabase database;
    private JobParameters parameters;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final Runnable timeout=()->finish(true);
    public static synchronized void schedule(Context context,long delay) {
        SharedPreferences prefs=context.getSharedPreferences("proactive_job",0);
        prefs.edit().putLong("delay",delay).apply();
        if(running)return;
        JobScheduler scheduler=context.getSystemService(JobScheduler.class);
        if(delay<=0){scheduler.cancel(ID);prefs.edit().remove("due").apply();return;}
        long due=System.currentTimeMillis()+Math.max(60000,delay),old=prefs.getLong("due",0);
        // Foreground heartbeat must not continually postpone an already scheduled job.
        if(scheduler.getPendingJob(ID)!=null&&old>0&&old<=due+30000)return;
        JobInfo job=new JobInfo.Builder(ID,new ComponentName(context,ProactiveJob.class))
            .setMinimumLatency(Math.max(60000,delay)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).build();
        if(scheduler.schedule(job)==JobScheduler.RESULT_SUCCESS)prefs.edit().putLong("due",due).apply();
    }
    @Override public boolean onStartJob(JobParameters params) {
        parameters=params;running=true;
        getSharedPreferences("proactive_job",0).edit().remove("due").apply();
        try {
            database=openOrCreateDatabase("between.sqlite",MODE_PRIVATE,null);database.setForeignKeyConstraintsEnabled(true);
            web=new WebView(this);web.getSettings().setJavaScriptEnabled(true);
            web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);
            bridge=new NativeBridge(this,database,code->handler.post(()->{if(web!=null)web.evaluateJavascript(code,null);})) {
                @JavascriptInterface public void finished(){handler.post(()->finish(false));}
            };
            web.addJavascriptInterface(bridge,"BetweenNative");
            web.setWebViewClient(new WebViewClient(){
                @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                    Uri uri=request.getUrl();String file=uri.getPath().equals("/background.html")?"background.html":uri.getPath().equals("/background.js")?"background.js":null;
                    if(!"https".equals(uri.getScheme())||!"appassets.androidplatform.net".equals(uri.getHost())||file==null)return blocked();
                    try{return new WebResourceResponse(file.endsWith(".js")?"text/javascript":"text/html","UTF-8",200,"OK",Collections.singletonMap("Content-Security-Policy","default-src 'none'; script-src 'self'; connect-src 'none'"),getAssets().open(file));}catch(Exception e){return blocked();}
                }
                @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}
            });
            handler.postDelayed(timeout,110000);web.loadUrl("https://appassets.androidplatform.net/background.html");return true;
        }catch(Exception error){cleanup();running=false;schedule(this,900000);return false;}
    }
    private static WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    private void finish(boolean retry){
        JobParameters done=parameters;if(done==null)return;
        cleanup();running=false;jobFinished(done,false);
        schedule(this,retry?900000:getSharedPreferences("proactive_job",0).getLong("delay",900000));
    }
    private void cleanup(){handler.removeCallbacks(timeout);parameters=null;if(bridge!=null){bridge.close();bridge=null;}if(web!=null){web.removeJavascriptInterface("BetweenNative");web.destroy();web=null;}if(database!=null){database.close();database=null;}}
    @Override public boolean onStopJob(JobParameters params){cleanup();running=false;return true;}
    @Override public void onDestroy(){cleanup();running=false;super.onDestroy();}
}
