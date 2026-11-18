// The child's ID-card photo (from the school), or the initials in the school colour.
import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { apiBase, authHeaders, type Child } from '@/lib/api';
import { schoolColor } from './ui';

export default function ChildPhoto({ child, size = 56 }: { child: Pick<Child, 'id' | 'fullName' | 'photo' | 'school'>; size?: number }) {
  const color = schoolColor(child.school.code);
  const box = { width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color };
  if (child.photo) {
    return <Image source={{ uri: `${apiBase()}/children/${child.id}/photo?v=${child.photo}`, headers: authHeaders() }} style={box} contentFit="cover" cachePolicy="memory-disk" />;
  }
  const ini = child.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('');
  return (
    <View style={[box, { backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color, fontWeight: '800', fontSize: size * 0.36 }}>{ini}</Text>
    </View>
  );
}
