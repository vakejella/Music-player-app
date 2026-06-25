package com.winamp.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewAssetLoader.AssetsPathHandler;

/**
 * Hosts the Winamp Mobile PWA in a full-screen WebView and bridges its player
 * to a native {@link PlaybackService} so playback shows up as a media
 * notification on the lock screen / shade.
 */
public class MainActivity extends Activity {

    private static final String BASE =
            "https://appassets.androidplatform.net/assets/www/index.html";
    private static final int FILE_CHOOSER_REQ = 0xF11E;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    private PlaybackService playbackService;
    private boolean serviceBound = false;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            playbackService = ((PlaybackService.LocalBinder) binder).getService();
            serviceBound = true;
            playbackService.setController(MainActivity.this::dispatchToWeb);
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            serviceBound = false;
            playbackService = null;
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);

        webView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                if (params != null && params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(Intent.createChooser(intent, "Select audio or skin"),
                            FILE_CHOOSER_REQ);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.addJavascriptInterface(new MediaBridge(), "AndroidMedia");
        webView.loadUrl(BASE);
        setContentView(webView);

        bindService(new Intent(this, PlaybackService.class), connection, Context.BIND_AUTO_CREATE);
        requestNotificationPermission();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, 0x500);
        }
    }

    /** Route a control event from the notification back into the web player. */
    private void dispatchToWeb(String command) {
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.__winampMedia && window.__winampMedia('" + command + "')", null));
    }

    private void ensureServiceStarted() {
        Intent i = new Intent(this, PlaybackService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i);
        else startService(i);
    }

    private Bitmap decodeDataUrl(String dataUrl) {
        if (dataUrl == null || dataUrl.isEmpty()) return null;
        int comma = dataUrl.indexOf(',');
        if (comma < 0) return null;
        try {
            byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) {
            return null;
        }
    }

    /** JavaScript-facing bridge: the web player pushes its state here. */
    private class MediaBridge {
        @JavascriptInterface
        public void setMetadata(String title, String artist, String artDataUrl, double durationSec) {
            final Bitmap art = decodeDataUrl(artDataUrl);
            runOnUiThread(() -> {
                ensureServiceStarted();
                if (serviceBound && playbackService != null) {
                    playbackService.updateMetadata(title, artist, art, (long) (durationSec * 1000));
                }
            });
        }

        @JavascriptInterface
        public void setPlayback(boolean playing, double positionSec) {
            runOnUiThread(() -> {
                ensureServiceStarted();
                if (serviceBound && playbackService != null) {
                    playbackService.updatePlayback(playing, (long) (positionSec * 1000));
                }
            });
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(() -> {
                if (serviceBound && playbackService != null) playbackService.stopPlayback();
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQ) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{ data.getData() };
                }
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (serviceBound) {
            try { unbindService(connection); } catch (Exception ignored) {}
            serviceBound = false;
        }
        super.onDestroy();
    }
}
