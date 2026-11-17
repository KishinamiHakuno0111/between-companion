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

import java.util.function.Consumer;

public class NativeBridge {
    protected final Context context;
    protected final SQLiteDatabase database;
    private final Consumer<String> evaluator;
    private final ExecutorService workers=Executors.newFixedThreadPool(4);
    private final ConcurrentHashMap<String,HttpURLConnection> connections=new ConcurrentHashMap<>();
    private final Set<String> cancelled=ConcurrentHashMap.newKeySet();
    private volatile boolean closed;
    public NativeBridge(Context context,SQLiteDatabase database,Consumer<String> evaluator){this.context=context;this.database=database;this.evaluator=evaluator;}
    private static byte[] utf8(String value){return value.getBytes(StandardCharsets.UTF_8);}
    private void networkEvent(String id,JSONObject event){if(!closed&&!cancelled.contains(id))evaluator.accept("window.__betweenNetwork("+JSONObject.quote(id)+","+event.toString()+")");}
    public void close(){closed=true;workers.shutdownNow();new Thread(()->{for(HttpURLConnection c:connections.values())c.disconnect();},"between-network-close").start();}
    @JavascriptInterface public void scheduleProactive(long delay){ProactiveJob.schedule(context,delay);}
    @JavascriptInterface public void notifyMessage(String character,String name,String id,String content){LocalNotifications.post(context,character,name,id,content);}
    @JavascriptInterface public void finished(){}
    @JavascriptInterface public String sha256(String value){try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(utf8(value));StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format("%02x",b&255));return out.toString();}catch(Exception error){throw new IllegalStateException(error);}}
    private Cursor query(String sql,String[] params){
        Cursor cursor=database.rawQuery(sql,params);
        if((sql.toLowerCase(Locale.ROOT).contains("attachments")||sql.toLowerCase(Locale.ROOT).contains("messages"))&&cursor instanceof AbstractWindowedCursor)((AbstractWindowedCursor)cursor).setWindow(new CursorWindow("between-content",32L*1024*1024));
        return cursor;
    }
        @JavascriptInterface public synchronized String sql(String mode,String sql,String args){
            try{
                JSONArray params=new JSONArray(args);
                if(mode.equals("exec")){
                    for(String statement:sql.split(";")){statement=statement.trim();if(statement.isEmpty())continue;
                        if(statement.equalsIgnoreCase("BEGIN"))database.beginTransaction();
                        else if(statement.equalsIgnoreCase("COMMIT")){database.setTransactionSuccessful();database.endTransaction();}
                        else if(statement.equalsIgnoreCase("ROLLBACK"))database.endTransaction();
                        else if(statement.toUpperCase(Locale.ROOT).startsWith("PRAGMA")){try(Cursor c=database.rawQuery(statement,null)){c.moveToFirst();}}
                        else database.execSQL(statement);
                    }return "{}";
                }
                if(mode.equals("all")){
                    String[] bindings=new String[params.length()];for(int i=0;i<bindings.length;i++)bindings[i]=params.isNull(i)?null:params.get(i).toString();
                    JSONArray rows=new JSONArray();try(Cursor c=query(sql,bindings)){
                        while(c.moveToNext()){JSONObject row=new JSONObject();for(int i=0;i<c.getColumnCount();i++){
                            Object value;switch(c.getType(i)){
                                case Cursor.FIELD_TYPE_NULL:value=JSONObject.NULL;break;
                                case Cursor.FIELD_TYPE_INTEGER:value=c.getLong(i);break;
                                case Cursor.FIELD_TYPE_FLOAT:value=c.getDouble(i);break;
                                case Cursor.FIELD_TYPE_BLOB:value=new JSONObject().put("__blob",Base64.encodeToString(c.getBlob(i),Base64.NO_WRAP));break;
                                default:value=c.getString(i);
                            }row.put(c.getColumnName(i),value);
                        }rows.put(row);}
                    }return rows.toString();
                }
                if(!mode.equals("run"))throw new IllegalArgumentException();
                try(SQLiteStatement statement=database.compileStatement(sql)){
                    for(int i=0;i<params.length();i++){Object value=params.get(i);int n=i+1;
                        if(value==JSONObject.NULL)statement.bindNull(n);
                        else if(value instanceof JSONObject&&((JSONObject)value).has("__blob"))statement.bindBlob(n,Base64.decode(((JSONObject)value).getString("__blob"),Base64.DEFAULT));
                        else if(value instanceof Number)statement.bindLong(n,((Number)value).longValue());
                        else if(value instanceof Boolean)statement.bindLong(n,((Boolean)value)?1:0);
                        else statement.bindString(n,value.toString());
                    }
                    statement.execute();
                }
                try(Cursor c=database.rawQuery("SELECT last_insert_rowid() AS id, changes() AS count",null)){c.moveToFirst();return new JSONObject().put("lastInsertRowid",c.getLong(0)).put("changes",c.getLong(1)).toString();}
            }catch(Exception error){try{return new JSONObject().put("error","本地数据库操作失败："+error.getClass().getSimpleName()).toString();}catch(Exception impossible){return "{\"error\":\"数据库错误\"}";}}
        }
        @JavascriptInterface public void cancel(String id){cancelled.add(id);HttpURLConnection connection=connections.remove(id);if(connection!=null)workers.execute(connection::disconnect);}
        @JavascriptInterface public void request(String id,String input){
            workers.execute(()->{
                HttpURLConnection connection=null;
                try{
                    JSONObject options=new JSONObject(input);URL url=new URL(options.getString("url"));
                    if(!Arrays.asList("https","http").contains(url.getProtocol())||url.getUserInfo()!=null)throw new IOException("Invalid URL");
                    if(cancelled.contains(id))return;
                    connection=(HttpURLConnection)url.openConnection();connections.put(id,connection);connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(30000);connection.setReadTimeout(600000);connection.setRequestMethod(options.optString("method","GET"));
                    connection.setRequestProperty("Accept-Encoding","identity");
                    JSONObject headers=options.getJSONObject("headers");Iterator<String> names=headers.keys();while(names.hasNext()){String name=names.next();if(!name.equalsIgnoreCase("host")&&!name.equalsIgnoreCase("content-length"))connection.setRequestProperty(name,headers.getString(name));}
                    String body=options.optString("body","");if(!body.isEmpty()){byte[] bytes=Base64.decode(body,Base64.DEFAULT);connection.setDoOutput(true);connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=connection.getOutputStream()){out.write(bytes);}}
                    if(cancelled.contains(id))return;
                    int status=connection.getResponseCode();JSONObject responseHeaders=new JSONObject();
                    for(Map.Entry<String,List<String>> h:connection.getHeaderFields().entrySet())if(h.getKey()!=null)responseHeaders.put(h.getKey(),String.join(", ",h.getValue()));
                    networkEvent(id,new JSONObject().put("type","headers").put("status",status).put("headers",responseHeaders));
                    InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream();
                    if(stream!=null)try(InputStream in=stream){byte[] buffer=new byte[16384];int count;while(!cancelled.contains(id)&&(count=in.read(buffer))!=-1){networkEvent(id,new JSONObject().put("type","data").put("data",Base64.encodeToString(buffer,0,count,Base64.NO_WRAP)));}}
                    networkEvent(id,new JSONObject().put("type","end"));
                }catch(Exception error){try{networkEvent(id,new JSONObject().put("type","error").put("message","网络请求失败，请检查网络、API 地址或证书。"));}catch(Exception ignored){}}
                finally{connections.remove(id);if(connection!=null)connection.disconnect();cancelled.remove(id);}
            });
        }
}
