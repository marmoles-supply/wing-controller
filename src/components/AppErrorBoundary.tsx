import React from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import HaCompensationEngine from '../ha/HaCompensationEngine';
import MacroEngine from '../osc/MacroEngine';
import OscManager from '../osc/OscManager';

type AppErrorBoundaryState = {
  failed: boolean;
};

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppErrorBoundary] Unhandled render error.', error, info.componentStack);
    try {
      MacroEngine.setRuntimeSuspended?.(true, 'unhandled UI error');
    } catch (shutdownError) {
      console.error('[AppErrorBoundary] Macro shutdown failed.', shutdownError);
    }
    try {
      const activePairId = HaCompensationEngine.getSnapshot?.()?.activePairId;
      if (activePairId) HaCompensationEngine.disarmPair?.(activePairId);
      HaCompensationEngine.setFocusedPair?.(null);
    } catch (shutdownError) {
      console.error('[AppErrorBoundary] HA shutdown failed.', shutdownError);
    }
    try {
      OscManager.disconnect();
    } catch (shutdownError) {
      console.error('[AppErrorBoundary] OSC shutdown failed.', shutdownError);
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <View style={styles.root} accessibilityRole="alert">
        <Text style={styles.title}>APP STOPPED SAFELY</Text>
        <Text style={styles.message}>No further console commands will be sent. Close and reopen the app.</Text>
        <TouchableOpacity style={styles.button} onPress={() => BackHandler.exitApp()} accessibilityRole="button">
          <Text style={styles.buttonText}>CLOSE APP</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 32,
    backgroundColor: '#0C0C0D',
  },
  title: {
    color: '#FF453A',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    maxWidth: 460,
    color: '#F2F2F7',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 6,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#636366',
    borderRadius: 6,
    backgroundColor: '#1C1C1E',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});
