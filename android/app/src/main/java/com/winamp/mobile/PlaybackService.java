package com.winamp.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;

/**
 * Foreground service that mirrors the WebView player's state into a
 * {@link MediaSession} and a MediaStyle notification, so the player shows up
 * on the lock screen / notification shade with album art and transport
 * controls — like a native music app.
 *
 * Commands from the notification / lock screen are routed back to the web
 * player through {@link Controller}.
 */
public class PlaybackService extends Service {

    public interface Controller {
        void onMediaCommand(String command);
    }

    static final String ACTION_PLAY = "play";
    static final String ACTION_PAUSE = "pause";
    static final String ACTION_NEXT = "next";
    static final String ACTION_PREV = "prev";
    static final String ACTION_STOP = "stop";

    private static final String CHANNEL_ID = "winamp_playback";
    private static final int NOTIFICATION_ID = 1001;

    private final IBinder binder = new LocalBinder();
    private MediaSession session;
    private Controller controller;

    private String title = "Winamp Mobile";
    private String artist = "";
    private Bitmap art;
    private boolean playing = false;
    private long positionMs = 0;
    private long durationMs = 0;
    private boolean started = false;

    public class LocalBinder extends Binder {
        public PlaybackService getService() {
            return PlaybackService.this;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    public void setController(Controller c) {
        this.controller = c;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }

        session = new MediaSession(this, "WinampMobile");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { cmd(ACTION_PLAY); }
            @Override public void onPause() { cmd(ACTION_PAUSE); }
            @Override public void onSkipToNext() { cmd(ACTION_NEXT); }
            @Override public void onSkipToPrevious() { cmd(ACTION_PREV); }
            @Override public void onStop() { cmd(ACTION_STOP); }
        });
        session.setActive(true);
    }

    private void cmd(String c) {
        if (controller != null) controller.onMediaCommand(c);
    }

    /** Notification action buttons are delivered here as service start intents. */
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) cmd(intent.getAction());
        return START_NOT_STICKY;
    }

    public void updateMetadata(String title, String artist, Bitmap art, long durationMs) {
        this.title = title != null ? title : "";
        this.artist = artist != null ? artist : "";
        this.art = art;
        this.durationMs = durationMs;
        applySession();
        showNotification();
    }

    public void updatePlayback(boolean playing, long positionMs) {
        this.playing = playing;
        this.positionMs = positionMs;
        applySession();
        showNotification();
    }

    public void stopPlayback() {
        playing = false;
        applySession();
        started = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.cancel(NOTIFICATION_ID);
    }

    private void applySession() {
        MediaMetadata.Builder mb = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (art != null) mb.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(mb.build());

        PlaybackState state = new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                        | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT
                        | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                        | PlaybackState.ACTION_STOP)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        positionMs, 1f)
                .build();
        session.setPlaybackState(state);
    }

    private PendingIntent actionIntent(String action) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getService(this, action.hashCode(), i, flags);
    }

    private Notification.Action action(int icon, String title, String cmd) {
        return new Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, icon),
                title, actionIntent(cmd)).build();
    }

    private void showNotification() {
        int pf = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent content = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class), pf);

        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        b.setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(artist)
                .setContentIntent(content)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(playing)
                .setShowWhen(false);
        if (art != null) b.setLargeIcon(art);

        b.addAction(action(android.R.drawable.ic_media_previous, "Previous", ACTION_PREV));
        if (playing) {
            b.addAction(action(android.R.drawable.ic_media_pause, "Pause", ACTION_PAUSE));
        } else {
            b.addAction(action(android.R.drawable.ic_media_play, "Play", ACTION_PLAY));
        }
        b.addAction(action(android.R.drawable.ic_media_next, "Next", ACTION_NEXT));

        Notification.MediaStyle style = new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2);
        b.setStyle(style);

        Notification n = b.build();
        if (!started) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
            started = true;
        } else {
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, n);
        }
    }

    @Override
    public void onDestroy() {
        if (session != null) session.release();
        super.onDestroy();
    }
}
