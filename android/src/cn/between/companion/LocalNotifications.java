package cn.between.companion;

import android.app.*;
import android.content.*;
import android.graphics.drawable.Icon;
import android.net.Uri;

public final class LocalNotifications {
    private static final String CHANNEL="proactive_messages";
    public static void post(Context context,String character,String name,String messageId,String content) {
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL,"角色主动联系",NotificationManager.IMPORTANCE_DEFAULT));
        if(!manager.areNotificationsEnabled())return;
        Intent intent=new Intent(context,MainActivity.class).setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse("between://chat/"+Uri.encode(character))).putExtra("characterId",character)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending=PendingIntent.getActivity(context,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        int icon=context.getResources().getIdentifier("notification_icon","drawable",context.getPackageName());
        Notification notification=new Notification.Builder(context,CHANNEL).setSmallIcon(icon)
            .setContentTitle(name).setContentText(content).setStyle(new Notification.BigTextStyle().bigText(content))
            .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true).build();
        manager.notify(messageId,1,notification);
    }
}
