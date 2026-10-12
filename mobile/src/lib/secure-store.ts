import * as SecureStore from 'expo-secure-store';

/**
 * Storage adapter conforming to Supabase auth storage requirements
 * using encrypted SecureStore on native platforms.
 */
export const secureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      console.warn(`[SecureStore] Error reading key "${key}":`, error);
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      throw new Error('Could not save encrypted local data');
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.warn(`[SecureStore] Error removing key "${key}":`, error);
    }
  },
};
