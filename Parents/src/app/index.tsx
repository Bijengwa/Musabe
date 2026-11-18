// Start: the animated splash, then the children (signed in) or the sign-in screen.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import AppSplash from '@/components/app-splash';
import { C } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Start() {
  const { ready, signedIn } = useSession();
  const [splash, setSplash] = useState(true);
  const done = useCallback(() => setSplash(false), []);
  useEffect(() => {
    if (!splash && ready) router.replace(signedIn ? '/home' : '/login');
  }, [splash, ready, signedIn]);
  return (
    <View style={{ flex: 1, backgroundColor: C.green }}>
      {splash && <AppSplash variant="parents" onDone={done} />}
    </View>
  );
}
