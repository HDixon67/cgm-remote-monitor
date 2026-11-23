package io.github.hdixon67.cgmhub;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HealthConnectPlugin.class);
        registerPlugin(BarcodeScanPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
