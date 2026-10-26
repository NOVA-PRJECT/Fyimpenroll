import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../config/constants';
import { useAuth } from './AuthContext';

interface SemesterContextType {
  activeSemester: number;
  setActiveSemester: (sem: number) => void;
  availableSemesters: number[];
}

const SemesterContext = createContext<SemesterContextType | undefined>(undefined);

export const SemesterProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { profile } = useAuth();
  const defaultSem = Math.min(profile?.current_semester || 1, 10);
  const [activeSemester, setActiveSemesterState] = useState<number>(defaultSem);

  useEffect(() => {
    if (profile?.current_semester) {
      setActiveSemesterState(Math.min(profile.current_semester, 10));
    } else {
      AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_SEMESTER).then((stored) => {
        if (stored) {
          const parsed = parseInt(stored, 10);
          if (!isNaN(parsed) && parsed > 0) {
            setActiveSemesterState(parsed);
          }
        }
      });
    }
  }, [profile?.current_semester]);

  const setActiveSemester = (sem: number) => {
    setActiveSemesterState(sem);
    AsyncStorage.setItem(STORAGE_KEYS.ACTIVE_SEMESTER, sem.toString()).catch(
      (err) => console.warn('[SemesterContext] Error saving semester:', err)
    );
  };

  const availableSemesters = Array.from({ length: Math.min(profile?.current_semester || 1, 10) }, (_, i) => i + 1);

  return (
    <SemesterContext.Provider
      value={{
        activeSemester,
        setActiveSemester,
        availableSemesters,
      }}
    >
      {children}
    </SemesterContext.Provider>
  );
};

export const useSemester = (): SemesterContextType => {
  const context = useContext(SemesterContext);
  if (!context) {
    throw new Error('useSemester must be used within a SemesterProvider');
  }
  return context;
};
