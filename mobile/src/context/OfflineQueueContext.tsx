import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { Alert } from 'react-native';
import { apiClient } from '../api/client';
import { secureStorage } from '../lib/secure-store';
import { OfflineActionQueue, QueuedAction } from '../lib/offline-queue';
import { useAuth } from './AuthContext';

export type OfflineActionType = QueuedAction['type'];
export type PendingAction = QueuedAction;
interface OfflineQueueContextType {
  isOnline: boolean;
  pendingActions: Record<OfflineActionType, PendingAction | null>;
  queuedCount: number;
  enqueueAction(type: OfflineActionType, endpoint: string, payload: unknown): Promise<void>;
  clearAction(type: OfflineActionType): Promise<void>;
  syncPendingActions(): Promise<void>;
}
const OfflineQueueContext = createContext<OfflineQueueContextType | undefined>(undefined);
const queue = new OfflineActionQueue(secureStorage);

export const OfflineQueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const owner = user?.id;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [isOnline, setIsOnline] = useState(true);
  const [actions, setActions] = useState<QueuedAction[]>([]);
  const update = useCallback((id: string, rows: QueuedAction[]) => {
    if (ownerRef.current === id) setActions(rows);
  }, []);
  useEffect(() => {
    setActions([]);
    if (owner) void queue.list(owner).then(rows => update(owner, rows)).catch(() => Alert.alert('Offline queue', 'Stored actions could not be read. They have not been submitted.'));
  }, [owner, update]);
  const enqueueAction = useCallback(async (type: OfflineActionType, endpoint: string, payload: unknown) => {
    if (!owner) throw new Error('Sign in before saving offline work');
    const rows = await queue.enqueue({ id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, ownerId: owner, type, endpoint, payload, clientTimestamp: new Date().toISOString() });
    update(owner, rows);
  }, [owner, update]);
  const clearAction = useCallback(async (type: OfflineActionType) => {
    if (owner) update(owner, await queue.clear(owner, type));
  }, [owner, update]);
  const syncPendingActions = useCallback(async () => {
    if (!owner) return;
    const rows = await queue.sync(owner, () => ownerRef.current === owner, async action => {
      await apiClient.post(action.endpoint, action.payload, { expectedUserId: owner });
    });
    update(owner, rows);
    if (rows[0]?.blockedReason) Alert.alert('Offline action needs review', rows[0].blockedReason + '. Refresh the class before submitting a new attendance revision.');
    // Successful API writes invalidate their own dependencies. Empty queue syncs do no reads.
  }, [owner, update]);
  useEffect(() => NetInfo.addEventListener(state => {
    const online = !!state.isConnected && state.isInternetReachable !== false;
    setIsOnline(online);
    if (online) void syncPendingActions().catch(() => {});
  }), [syncPendingActions]);
  return <OfflineQueueContext.Provider value={{ isOnline, queuedCount: actions.length,
    pendingActions: { CAMPUS_SIGN_IN: actions.find(a => a.type === 'CAMPUS_SIGN_IN') || null, PERIOD_MARKING: actions.find(a => a.type === 'PERIOD_MARKING') || null },
    enqueueAction, clearAction, syncPendingActions }}>{children}</OfflineQueueContext.Provider>;
};
export const useOfflineQueue = () => {
  const context = useContext(OfflineQueueContext);
  if (!context) throw new Error('useOfflineQueue must be used within an OfflineQueueProvider');
  return context;
};
