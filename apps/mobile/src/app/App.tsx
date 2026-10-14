import { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StatusBar, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppServices } from '../services/container';
import { ServicesContext } from './ServicesContext';
import { EncryptionUnavailableError } from '../storage/db';
import { LoginScreen } from '../screens/LoginScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { CheckinScreen } from '../screens/CheckinScreen';
import { CaptureScreen } from '../screens/CaptureScreen';
import { EvidenceScreen } from '../screens/EvidenceScreen';
import { LedgerScreen } from '../screens/LedgerScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors, styles } from '../components/ui';
import type { RootStack } from '../navigation/types';

const Stack = createNativeStackNavigator<RootStack>();

export default function App() {
  const [services, setServices] = useState<AppServices | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  useEffect(() => {
    AppServices.bootstrap()
      .then(setServices)
      .catch((e) => {
        setFatal(
          e instanceof EncryptionUnavailableError
            ? `Encrypted storage unavailable: ${e.message} PRAMAAN will not store evidence without encryption.`
            : `Start-up failed: ${(e as Error).message}`,
        );
      });
  }, []);
  if (fatal) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.h1, { color: colors.bad }]}>Cannot start securely</Text>
          <Text style={styles.p}>{fatal}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (!services)
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={[styles.p, { padding: 16 }]}>Opening encrypted ledger…</Text>
      </SafeAreaView>
    );
  return (
    <ServicesContext.Provider value={services}>
      <StatusBar barStyle="light-content" />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={services.identity ? 'Home' : 'Login'}
          screenOptions={{
            headerStyle: { backgroundColor: colors.ink },
            headerTintColor: colors.white,
          }}
        >
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'PRAMAAN' }} />
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'PRAMAAN — Duty' }} />
          <Stack.Screen
            name="Register"
            component={RegisterScreen}
            options={{ title: 'Register device' }}
          />
          <Stack.Screen
            name="Checkin"
            component={CheckinScreen}
            options={{ title: 'Check-in', gestureEnabled: false }}
          />
          <Stack.Screen
            name="Capture"
            component={CaptureScreen}
            options={{ title: 'Capture evidence' }}
          />
          <Stack.Screen
            name="Evidence"
            component={EvidenceScreen}
            options={{ title: 'Evidence' }}
          />
          <Stack.Screen
            name="Ledger"
            component={LedgerScreen}
            options={{ title: 'Local ledger' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Permissions & device' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ServicesContext.Provider>
  );
}
