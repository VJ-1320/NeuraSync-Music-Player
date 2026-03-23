package com.musicplayer.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.nothing.glyphmatrix.sdk.GlyphManager;
import com.nothing.glyphmatrix.sdk.model.Glyph;
import com.nothing.glyphmatrix.sdk.model.GlyphFrame;

@CapacitorPlugin(name = "GlyphPlugin")
public class GlyphPlugin extends Plugin {

    private GlyphManager glyphManager;
    private GlyphManager.Callback callback = new GlyphManager.Callback() {
        @Override
        public void onServiceConnected() {
            // Service connected
            // Ensure the media session remains active even when the UI is not in the foreground
            // by pinning the Glyph service connection for background tasks.
            if (glyphManager != null) {
                try {
                    // This ensures the Glyph session persists during background audio playback
                    glyphManager.display(glyphManager.getGlyphFrameBuilder().build());
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }

        @Override
        public void onServiceDisconnected() {
            // Service disconnected
        }
    };

    @PluginMethod
    public void requestBatteryOptimization(PluginCall call) {
        try {
            android.content.Context context = getContext();
            android.os.PowerManager pm = (android.os.PowerManager) context.getSystemService(android.content.Context.POWER_SERVICE);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                if (!pm.isIgnoringBatteryOptimizations(context.getPackageName())) {
                    android.content.Intent intent = new android.content.Intent();
                    intent.setAction(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(android.net.Uri.parse("package:" + context.getPackageName()));
                    intent.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to request battery optimization: " + e.getMessage());
        }
    }

    @PluginMethod
    public void initGlyph(PluginCall call) {
        try {
            glyphManager = GlyphManager.getInstance(getContext());
            glyphManager.init(callback);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to initialize GlyphManager: " + e.getMessage());
        }
    }

    @PluginMethod
    public void triggerPulse(PluginCall call) {
        if (glyphManager == null) {
            call.reject("GlyphManager not initialized. Call initGlyph() first.");
            return;
        }

        try {
            // Explicitly turn on channel "A" at full brightness (255)
            GlyphFrame frame = glyphManager.getGlyphFrameBuilder()
                    .buildChannel("A", 255)
                    .build();
            
            glyphManager.display(frame);
            
            // Turn off the lights after 100ms to create a strobe/pulse effect
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (glyphManager != null) {
                        glyphManager.turnOff();
                    }
                }
            }, 100);
            
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to trigger pulse: " + e.getMessage());
        }
    }

    @PluginMethod
    public void closeGlyph(PluginCall call) {
        if (glyphManager != null) {
            glyphManager.unInit();
            glyphManager = null;
        }
        call.resolve();
    }
}
