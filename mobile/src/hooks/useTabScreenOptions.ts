import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './useTheme';

export function useTabScreenOptions() {
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();

  // On devices with system navigation bars (Android 3-button/gesture bar, iOS home bar),
  // insets.bottom reflects the physical system navigation area (typically 16-48px).
  // When insets.bottom is 0 (e.g. older devices or hardware buttons), fallback to 8-10px.
  const bottomInset = insets.bottom > 0 ? insets.bottom : (Platform.OS === 'android' ? 10 : 8);
  const tabHeight = 56 + bottomInset;

  return {
    tabBarHideOnKeyboard: true,
    headerShadowVisible: false,
    tabBarActiveTintColor: colors.tabBarActive,
    tabBarInactiveTintColor: colors.tabBarInactive,
    tabBarStyle: {
      backgroundColor: colors.tabBarBackground,
      borderTopColor: colors.tabBarBorder,
      height: tabHeight,
      paddingBottom: bottomInset,
      paddingTop: 6,
    },
    tabBarLabelStyle: {
      ...typography.caption,
      fontWeight: '600' as const,
    },
    headerStyle: {
      backgroundColor: colors.surface,
    },
    headerTintColor: colors.textPrimary,
    headerTitleStyle: {
      ...typography.h3,
    },
  };
}
