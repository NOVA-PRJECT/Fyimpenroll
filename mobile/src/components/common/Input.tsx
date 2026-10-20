import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  isPassword?: boolean;
}

export const Input = React.forwardRef<React.ComponentRef<typeof TextInput>, InputProps>(({
  label,
  error,
  leftIcon,
  isPassword = false,
  style,
  onFocus,
  onBlur,
  ...props
}, ref) => {
  const { colors, borderRadius, layout, typography, spacing } = useTheme();
  const [showPassword, setShowPassword] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={styles.container}>
      {label && (
        <Text
          style={[
            typography.bodySmall,
            { color: colors.textSecondary, marginBottom: spacing.xs },
          ]}
        >
          {label}
        </Text>
      )}

      <View
        style={[
          styles.inputWrapper,
          {
            minHeight: layout.minTouchTarget,
            backgroundColor: colors.surface,
            borderColor: error
              ? colors.danger
              : isFocused
              ? colors.primary
              : colors.border,
            borderRadius: borderRadius.md,
          },
        ]}
      >
        {leftIcon && (
          <Ionicons
            name={leftIcon}
            size={20}
            color={colors.textSecondary}
            style={styles.leftIcon}
          />
        )}

        <TextInput
          {...props}
          ref={ref}
          accessibilityLabel={props.accessibilityLabel ?? label}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={isPassword ? !showPassword : props.secureTextEntry}
          onFocus={(event) => { setIsFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setIsFocused(false); onBlur?.(event); }}
          style={[
            styles.textInput,
            typography.bodyLarge,
            { color: colors.textPrimary },
            style,
          ]}
        />

        {isPassword && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            onPress={() => setShowPassword(!showPassword)}
            style={styles.rightIcon}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>

      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[
            typography.caption,
            { color: colors.danger, marginTop: spacing.xs },
          ]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
});
Input.displayName = 'Input';

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 16,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  leftIcon: {
    marginRight: 8,
  },
  rightIcon: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    minHeight: 52,
    paddingVertical: 12,
  },
});
