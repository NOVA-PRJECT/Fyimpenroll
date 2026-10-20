import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, ViewStyle, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';

interface SkeletonProps {
  width?: number | `${number}%` | 'auto';
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius: customRadius,
  style,
}) => {
  const { colors, borderRadius: defaultRadius } = useTheme();
  const opacityAnim = useRef(new Animated.Value(0.3)).current;
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacityAnim.setValue(0.6);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacityAnim, {
          toValue: 0.8,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();

    return () => animation.stop();
  }, [opacityAnim, reduceMotion]);

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.skeleton,
        {
          width: width as any,
          height,
          borderRadius: customRadius ?? defaultRadius.sm,
          backgroundColor: colors.skeletonBase,
          opacity: opacityAnim,
        },
        style,
      ]}
    />
  );
};

const styles = StyleSheet.create({
  skeleton: {
    marginVertical: 4,
  },
});
