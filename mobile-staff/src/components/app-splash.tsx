import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, FadeInUp, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';

const LOGO = require('../../assets/images/musabe-logo.png');

// One splash, two looks. Both last 5 seconds: crest pops in, rings ripple, name and tagline rise,
// the three schools appear one by one, a progress bar fills, then everything fades out.
export type Variant = 'staff' | 'parents';
const THEME = {
  staff: {
    name: 'Musabe Staff', tagline: 'Musabe Schools, one system', colors: ['#0a2f23', '#0d4a3d', '#12806f'] as const,
    acc: '#5fe0c4', orb2: '#12806f',
  },
  parents: {
    name: 'Musabe Parents', tagline: "Stay close to your child's school", colors: ['#0f5a3a', '#2f7a45', '#d9b24a'] as const,
    acc: '#f6dc8a', orb2: '#d9b24a',
  },
};
const SCHOOLS: [string, string, string][] = [
  ['#d9822b', 'Nursery & Primary', 'pre'],
  ['#6c9ff0', 'Boys Secondary', 'boys'],
  ['#ec74b1', 'Girls Secondary', 'girls'],
];

function Orb({ size, style, delay = 0, color }: { size: number; style: object; delay?: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 4500, easing: Easing.inOut(Easing.quad) }), -1, true)); }, [delay, t]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: t.value * 34 }, { translateY: -t.value * 28 }, { scale: 1 + t.value * 0.2 }] }));
  return <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size, backgroundColor: color, opacity: 0.35 }, style, a]} />;
}

function Ring({ delay, color }: { delay: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1, false)); }, [delay, t]);
  const a = useAnimatedStyle(() => ({ opacity: 0.7 * (1 - t.value), transform: [{ scale: 0.78 + t.value * 0.45 }] }));
  return <Animated.View style={[styles.ring, { borderColor: color }, a]} />;
}

// Small lights floating upward (used by the Parents look).
function Spark({ left, delay, size, color }: { left: number; delay: number; size: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 3600, easing: Easing.linear }), -1, false)); }, [delay, t]);
  const a = useAnimatedStyle(() => ({ opacity: Math.sin(t.value * Math.PI) * 0.8, transform: [{ translateY: -t.value * 520 }, { translateX: Math.sin(t.value * 6) * 14 }] }));
  return <Animated.View style={[{ position: 'absolute', bottom: 20, left: `${left}%`, width: size, height: size, borderRadius: size, backgroundColor: color }, a]} />;
}

function SchoolChip({ color, label, delay }: { color: string; label: string; delay: number }) {
  return (
    <Animated.View entering={FadeInUp.delay(delay).duration(500).springify().damping(14)} style={styles.chip}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.chipText}>{label}</Text>
    </Animated.View>
  );
}

export default function AppSplash({ variant, onDone, totalMs = 5000 }: { variant: Variant; onDone: () => void; totalMs?: number }) {
  const th = THEME[variant];
  const pop = useSharedValue(0);
  const sweep = useSharedValue(0);
  const breathe = useSharedValue(0);
  const bar = useSharedValue(0);
  const out = useSharedValue(1);
  const FADE = 450;

  useEffect(() => {
    pop.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.back(2)) });
    sweep.value = withDelay(1000, withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, false));
    breathe.value = withDelay(1000, withRepeat(withSequence(withTiming(1, { duration: 1200 }), withTiming(0, { duration: 1200 })), -1, false));
    bar.value = withDelay(900, withTiming(1, { duration: totalMs - FADE - 900, easing: Easing.inOut(Easing.cubic) }));
    out.value = withDelay(totalMs - FADE, withTiming(0, { duration: FADE }, (done) => { if (done) runOnJS(onDone)(); }));
  }, [totalMs, onDone, out, pop, sweep, breathe, bar]);

  const wrap = useAnimatedStyle(() => ({ opacity: out.value, transform: [{ scale: 1 + (1 - out.value) * 0.05 }] }));
  const crest = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ scale: (0.4 + pop.value * 0.6) * (variant === 'parents' ? 1 + breathe.value * 0.07 : 1) }, { rotate: `${(1 - pop.value) * -12}deg` }],
  }));
  const line = useAnimatedStyle(() => ({ transform: [{ translateY: -40 + sweep.value * 160 }] }));
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: bar.value }] }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, wrap]} pointerEvents="none">
      <LinearGradient colors={th.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
        <Orb size={260} style={{ top: -70, left: -80 }} color={th.acc} />
        <Orb size={300} style={{ bottom: -110, right: -90 }} delay={1500} color={th.orb2} />
        <Orb size={150} style={{ top: '55%', right: 20 }} delay={3000} color={th.acc} />
        {variant === 'parents' && [8, 22, 38, 52, 66, 80, 91].map((l, i) => <Spark key={l} left={l} delay={i * 450} size={6 + (i % 3) * 3} color={th.acc} />)}

        <View style={styles.crestWrap}>
          <Ring delay={700} color={th.acc} /><Ring delay={1400} color={th.acc} /><Ring delay={2100} color={th.acc} />
          <Animated.View style={[styles.glass, crest]}>
            <Animated.Image source={LOGO} style={styles.logo} resizeMode="contain" />
            {variant === 'staff' && <Animated.View style={[styles.sweep, line]} />}
          </Animated.View>
        </View>

        <Animated.Text entering={FadeInDown.delay(600).duration(700)} style={styles.name}>{th.name}</Animated.Text>
        <Animated.Text entering={FadeInDown.delay(900).duration(700)} style={styles.tag}>{th.tagline}</Animated.Text>

        <View style={styles.chips}>
          {SCHOOLS.map(([c, l], i) => <SchoolChip key={l} color={c} label={l} delay={1600 + i * 450} />)}
        </View>

        <Animated.View entering={FadeIn.delay(1000)} style={styles.track}><Animated.View style={[styles.bar, { backgroundColor: th.acc }, fill]} /></Animated.View>
        <Animated.Text entering={FadeIn.delay(1200).duration(800)} style={styles.foot}>Musabe Schools · Buhongwa, Mwanza</Animated.Text>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  crestWrap: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  glass: { width: 120, height: 120, borderRadius: 32, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)' },
  logo: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#fff' },
  ring: { position: 'absolute', width: 160, height: 160, borderRadius: 44, borderWidth: 2 },
  sweep: { position: 'absolute', left: 0, right: 0, top: 0, height: 40, backgroundColor: 'rgba(255,255,255,0.4)' },
  name: { color: '#fff', fontSize: 30, fontWeight: '700', letterSpacing: -0.3, textAlign: 'center' },
  tag: { color: 'rgba(255,255,255,0.88)', fontSize: 15, marginTop: 6, textAlign: 'center', paddingHorizontal: 30 },
  chips: { marginTop: 26, gap: 8, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  track: { marginTop: 30, width: 130, height: 4, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  bar: { height: 4, width: 130, borderRadius: 4, transformOrigin: 'left' },
  foot: { position: 'absolute', bottom: 40, color: 'rgba(255,255,255,0.65)', fontSize: 12 },
});
