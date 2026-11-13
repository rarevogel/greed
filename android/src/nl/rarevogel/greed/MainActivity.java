package nl.rarevogel.greed;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.DisplayCutout;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.ValueCallback;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.InputStream;

public class MainActivity extends Activity {
    static final String HOST = "greed.local";
    WebView web;
    FrameLayout frame;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.parseColor("#06080a"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#06080a"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(), "GreedApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                try {
                    InputStream in = getAssets().open(path.substring(1));
                    String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript" : "application/octet-stream";
                    return new WebResourceResponse(mime, "utf-8", in);
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", null, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (HOST.equals(r.getUrl().getHost()) || !r.isForMainFrame()) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Exception ignored) {}
                return true;
            }
        });
        frame.addView(web, new FrameLayout.LayoutParams(-1, -1));
        // keep the game clear of the status bar, navigation bar and camera cutout
        frame.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() { public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
            int l = in.getSystemWindowInsetLeft(), t = in.getSystemWindowInsetTop(), rr = in.getSystemWindowInsetRight(), b = in.getSystemWindowInsetBottom();
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout c = in.getDisplayCutout();
                if (c != null) { l = Math.max(l, c.getSafeInsetLeft()); t = Math.max(t, c.getSafeInsetTop()); rr = Math.max(rr, c.getSafeInsetRight()); b = Math.max(b, c.getSafeInsetBottom()); }
            }
            v.setPadding(l, t, rr, b);
            return in;
        }});
        setContentView(frame);
        frame.requestApplyInsets();
        if (state != null) web.restoreState(state);
        else web.loadUrl("https://" + HOST + "/");
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onPause() { super.onPause(); web.evaluateJavascript("dispatchEvent(new Event('pagehide'))", null); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__terug ? String(__terug()) : 'false'", new ValueCallback<String>() {
            public void onReceiveValue(String r) { if (!"\"true\"".equals(r) && !"true".equals(r)) finish(); }
        });
    }

    class Bridge {
        @JavascriptInterface
        public void setBars(final String hex) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    int c = Color.parseColor(hex);
                    frame.setBackgroundColor(c);
                    web.setBackgroundColor(c);
                    Window w = getWindow();
                    w.setStatusBarColor(c);
                    w.setNavigationBarColor(c);
                    boolean light = (Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000 > 150;
                    int f = w.getDecorView().getSystemUiVisibility();
                    f = light ? (f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR) : (f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
                    if (Build.VERSION.SDK_INT >= 26) f = light ? (f | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR) : (f & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
                    w.getDecorView().setSystemUiVisibility(f);
                } catch (Exception ignored) {}
            }});
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(Math.max(1, ms), VibrationEffect.DEFAULT_AMPLITUDE));
                else v.vibrate(ms);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void share(final String text) {
            runOnUiThread(new Runnable() { public void run() {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                try { startActivity(Intent.createChooser(i, "Share your Greed score")); } catch (Exception ignored) {}
            }});
        }
    }
}
