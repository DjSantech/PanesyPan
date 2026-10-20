package com.panesypan.pos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin nativo para la impresora térmica y la caja registradora.
        registerPlugin(EscPosPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
