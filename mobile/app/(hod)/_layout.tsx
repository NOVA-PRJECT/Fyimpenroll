import React from 'react';
import { Tabs } from 'expo-router';
import { useTabScreenOptions } from '../../src/hooks/useTabScreenOptions';
import { TabBarIcon } from '../../src/components/layout/TabBarIcon';

export default function HodLayout() {
  const screenOptions = useTabScreenOptions();

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerTitle: 'HOD Department Portal',
          tabBarLabel: 'Home',
          tabBarIcon: ({ color }) => <TabBarIcon name="pie-chart-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          headerTitle: 'Campus Attendance Roster',
          tabBarLabel: 'Attendance',
          tabBarIcon: ({ color }) => <TabBarIcon name="people-outline" color={color} />,
        }}
      />
    </Tabs>
  );
}
