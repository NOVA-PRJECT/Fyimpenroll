import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';

interface TabBarIconProps {
  name: keyof typeof Ionicons.glyphMap;
  color: ColorValue;
  size?: number;
}

export const TabBarIcon: React.FC<TabBarIconProps> = ({
  name,
  color,
  size = 24,
}) => {
  return <Ionicons name={name} size={size} style={{ color, marginBottom: -3 }} />;
};
