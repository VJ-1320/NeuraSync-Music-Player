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
        }

        @Override
        public void onServiceDisconnected() {
            // Service disconnected
        }
    };

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
