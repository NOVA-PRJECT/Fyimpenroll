import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { useTheme } from '../../hooks/useTheme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  textStyle,
  icon,
}) => {
  const { colors, borderRadius, layout, typography } = useTheme();

  const getBackgroundColor = () => {
    if (disabled) return colors.border;
    switch (variant) {
      case 'primary':
        return colors.primaryDark;
      case 'secondary':
        return colors.surface;
      case 'outline':
        return 'transparent';
      case 'danger':
        return '#B91C1C';
      default:
        return colors.primary;
    }
  };

  const getTextColor = () => {
    if (disabled) return colors.textMuted;
    switch (variant) {
      case 'primary':
      case 'danger':
        return '#FFFFFF';
      case 'secondary':
        return colors.textPrimary;
      case 'outline':
        return colors.primary;
      default:
        return '#FFFFFF';
    }
  };

  const getBorderColor = () => {
    if (variant === 'outline') {
      return disabled ? colors.border : colors.primary;
    }
    if (variant === 'secondary') {
      return colors.border;
    }
    return 'transparent';
  };

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[
        styles.base,
        {
          minHeight: layout.minTouchTarget,
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          borderWidth: variant === 'outline' || variant === 'secondary' ? 1 : 0,
          borderRadius: borderRadius.md,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={getTextColor()} size="small" />
      ) : (
        <>
          {icon}
          <Text
            style={[
              typography.button,
              { color: getTextColor(), marginLeft: icon ? 8 : 0, textAlign: 'center', flexShrink: 1 },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
