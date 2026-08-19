package com.fintracker.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FinancePetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
