import { useState, useEffect, useRef, useCallback } from 'react';
import type { MessageSummary } from '@easytmp/shared';
import { apiClient, ApiError } from '../api/client';
import { normalizeMailboxInput } from '../utils/mailbox';

const POLL_INTERVAL_MS = 3000;

export interface UseMailboxReturn {
  name: string;
  address: string;
  taskSince: number | null;
  messages: MessageSummary[];
  selectedMessageId: string | null;
  isLoading: boolean;
  isPolling: boolean;
  isDocumentHidden: boolean;
  error: string | null;
  lastPolledAt: number | null;
  nextCursor: string | null;
  hasMore: boolean;
  switchMailbox: (rawInput: string) => Promise<boolean>;
  generateRandomMailbox: () => Promise<void>;
  manualRefresh: () => Promise<void>;
  clearCurrentMailbox: () => Promise<boolean>;
  deleteSingleMessage: (id: string) => Promise<boolean>;
  loadMoreMessages: () => Promise<void>;
  setSelectedMessageId: (id: string | null) => void;
  clearError: () => void;
  resetTaskSince: () => Promise<void>;
  toggleShowAllMessages: () => void;
  showAllMessages: boolean;
}

export function useMailbox(): UseMailboxReturn {
  const [name, setName] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [taskSince, setTaskSinceState] = useState<number | null>(null);
  const [showAllMessages, setShowAllMessagesState] = useState<boolean>(false);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isDocumentHidden, setIsDocumentHidden] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);

  // References for values needed by callbacks without triggering re-render cascades
  const nameRef = useRef<string>('');
  const taskSinceRef = useRef<number | null>(null);
  const showAllMessagesRef = useRef<boolean>(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);
  const pollTimerRef = useRef<number | null>(null);
  const isPollingInFlightRef = useRef<boolean>(false);

  const setTaskSince = useCallback((val: number | null) => {
    taskSinceRef.current = val;
    setTaskSinceState(val);
  }, []);

  const setShowAllMessages = useCallback((val: boolean) => {
    showAllMessagesRef.current = val;
    setShowAllMessagesState(val);
  }, []);

  // Helper to deduplicate and sort messages by receivedAt DESC, id DESC
  const mergeMessages = useCallback((prev: MessageSummary[], incoming: MessageSummary[]) => {
    const map = new Map<string, MessageSummary>();
    for (const msg of prev) {
      map.set(msg.id, msg);
    }
    for (const msg of incoming) {
      map.set(msg.id, msg);
    }
    const combined = Array.from(map.values());
    combined.sort((a, b) => {
      if (b.receivedAt !== a.receivedAt) {
        return b.receivedAt - a.receivedAt;
      }
      return b.id.localeCompare(a.id);
    });
    return combined;
  }, []);

  /**
   * Reconciles incoming first-page messages with existing messages.
   * Authoritative first-page from the server replaces stale/deleted/expired messages.
   */
  const reconcileMessages = useCallback(
    (prev: MessageSummary[], incoming: MessageSummary[], hasMore: boolean, serverTime: number) => {
      if (incoming.length === 0) {
        return [];
      }

      let result: MessageSummary[];
      if (!hasMore) {
        result = [...incoming];
      } else {
        const freshIds = new Set(incoming.map((m) => m.id));
        const oldestInPage = incoming[incoming.length - 1];

        const retainedOlder = prev.filter((m) => {
          const isOlder =
            m.receivedAt < oldestInPage.receivedAt ||
            (m.receivedAt === oldestInPage.receivedAt && m.id < oldestInPage.id);
          return isOlder && !freshIds.has(m.id) && m.expiresAt > serverTime;
        });

        result = [...incoming, ...retainedOlder];
      }

      result.sort((a, b) => {
        if (b.receivedAt !== a.receivedAt) {
          return b.receivedAt - a.receivedAt;
        }
        return b.id.localeCompare(a.id);
      });
      return result;
    },
    [],
  );

  /**
   * Internal fetch function for a given mailbox name.
   */
  const fetchMessages = useCallback(
    async (
      targetName: string,
      options: {
        isBackgroundPoll?: boolean;
        overrideSince?: number | null;
        cursor?: string;
        isLoadMore?: boolean;
      } = {},
    ) => {
      if (!targetName) return;

      // Prevent concurrent polling executions to avoid race conditions
      if (options.isBackgroundPoll) {
        if (isPollingInFlightRef.current) {
          return;
        }
        isPollingInFlightRef.current = true;
      } else if (!options.isLoadMore) {
        // Foreground navigation / switch: abort in-flight requests
        if (activeAbortControllerRef.current) {
          activeAbortControllerRef.current.abort();
        }
      }

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;
      const currentRequestId = ++requestIdRef.current;

      if (!options.isBackgroundPoll && !options.isLoadMore) {
        setIsLoading(true);
      }
      if (options.isBackgroundPoll) {
        setIsPolling(true);
      }

      try {
        const sinceParam =
          options.overrideSince !== undefined
            ? (options.overrideSince ?? undefined)
            : showAllMessagesRef.current
              ? undefined
              : (taskSinceRef.current ?? undefined);

        const res = await apiClient.listMessages(targetName, {
          since: sinceParam,
          cursor: options.cursor,
          limit: 20,
          signal: controller.signal,
        });

        // Ensure we only update state if this is still the active request
        if (requestIdRef.current !== currentRequestId) {
          return;
        }

        setError(null);
        setLastPolledAt(res.serverTime || Date.now());
        setNextCursor(res.pagination.nextCursor);

        setMessages((prev) => {
          if (options.isLoadMore) {
            return mergeMessages(prev, res.messages);
          }
          // Authoritative reconcile for first-page polls
          return reconcileMessages(
            prev,
            res.messages,
            Boolean(res.pagination.nextCursor),
            res.serverTime || Date.now(),
          );
        });
      } catch (err: unknown) {
        if (requestIdRef.current !== currentRequestId) {
          return;
        }
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (err instanceof ApiError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message || '网络请求异常');
        } else {
          setError('发生未知错误');
        }
      } finally {
        if (options.isBackgroundPoll) {
          isPollingInFlightRef.current = false;
        }
        if (requestIdRef.current === currentRequestId) {
          setIsLoading(false);
          setIsPolling(false);
        }
      }
    },
    [mergeMessages, reconcileMessages],
  );

  /**
   * Generates a new random address on initialization or button click.
   */
  const generateRandomMailbox = useCallback(async () => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;
    const currentRequestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);
    setSelectedMessageId(null);
    setMessages([]);
    setNextCursor(null);

    try {
      const res = await apiClient.getRandomAddress(controller.signal);
      if (requestIdRef.current !== currentRequestId) return;

      nameRef.current = res.name;
      setName(res.name);
      setAddress(res.address);
      setTaskSince(res.serverTime);

      // Query first page with serverTime as since
      await fetchMessages(res.name, {
        overrideSince: res.serverTime,
      });
    } catch (err: unknown) {
      if (requestIdRef.current !== currentRequestId) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('无法生成随机邮箱地址，请刷新重试');
      }
      setIsLoading(false);
    }
  }, [fetchMessages, setTaskSince]);

  /**
   * Switch mailbox manually.
   * Input is normalized and validated.
   * Crucial: Must query ALL unexpired messages by default (overrideSince: null).
   * Does NOT delete emails from previous mailbox.
   */
  const switchMailbox = useCallback(
    async (rawInput: string): Promise<boolean> => {
      const validation = normalizeMailboxInput(rawInput);
      if (!validation.valid || !validation.name || !validation.address) {
        setError(validation.error || '邮箱名不合法');
        return false;
      }

      const newName = validation.name;
      const newAddress = validation.address;

      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }

      setError(null);
      setSelectedMessageId(null);
      nameRef.current = newName;
      setName(newName);
      setAddress(newAddress);
      setMessages([]);
      setNextCursor(null);

      // Switched / manual mailbox defaults to showing ALL unexpired messages
      setTaskSince(null);
      setShowAllMessages(true);

      await fetchMessages(newName, {
        overrideSince: null,
      });
      return true;
    },
    [fetchMessages, setTaskSince, setShowAllMessages],
  );

  /**
   * Manual refresh uses authoritative server time if taskSince is active,
   * or queries all if showAllMessages is active.
   */
  const manualRefresh = useCallback(async () => {
    if (!name) return;
    setError(null);

    if (taskSinceRef.current !== null && !showAllMessagesRef.current) {
      try {
        const health = await apiClient.getHealth();
        const serverTime = health.serverTime;
        setTaskSince(serverTime);
        await fetchMessages(name, { overrideSince: serverTime });
      } catch {
        // Fallback to current taskSince if health call fails
        await fetchMessages(name, { overrideSince: taskSinceRef.current });
      }
    } else {
      await fetchMessages(name, { overrideSince: null });
    }
  }, [name, fetchMessages, setTaskSince]);

  /**
   * Clear current mailbox after browser confirmation.
   */
  const clearCurrentMailbox = useCallback(async (): Promise<boolean> => {
    if (!name) return false;
    const confirmed = window.confirm('确定要清空当前收件箱中的全部邮件吗？此操作不可撤销。');
    if (!confirmed) return false;

    setIsLoading(true);
    setError(null);
    try {
      await apiClient.clearMailbox(name);
      setMessages([]);
      setNextCursor(null);
      setSelectedMessageId(null);
      return true;
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('清空收件箱失败，请稍后重试');
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [name]);

  /**
   * Delete single message.
   * Confirmation is handled exclusively by the UI component (MessageDetail)
   * to prevent redundant double confirmation.
   */
  const deleteSingleMessage = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await apiClient.deleteMessage(id);
        setMessages((prev) => prev.filter((m) => m.id !== id));
        if (selectedMessageId === id) {
          setSelectedMessageId(null);
        }
        return true;
      } catch (err: unknown) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('删除邮件失败，请重试');
        }
        return false;
      }
    },
    [selectedMessageId],
  );

  /**
   * Load more older messages using pagination cursor.
   */
  const loadMoreMessages = useCallback(async () => {
    if (!name || !nextCursor || isLoading) return;
    await fetchMessages(name, {
      cursor: nextCursor,
      isLoadMore: true,
    });
  }, [name, nextCursor, isLoading, fetchMessages]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Resets baseline task start time using authoritative server time from /api/health.
   */
  const resetTaskSince = useCallback(async () => {
    try {
      const health = await apiClient.getHealth();
      const serverTime = health.serverTime;
      setTaskSince(serverTime);
      setShowAllMessages(false);
      if (name) {
        await fetchMessages(name, { overrideSince: serverTime });
      }
    } catch {
      // If health fetch fails, retain current taskSince
      if (name) {
        await fetchMessages(name);
      }
    }
  }, [name, fetchMessages, setTaskSince, setShowAllMessages]);

  const toggleShowAllMessages = useCallback(() => {
    const next = !showAllMessagesRef.current;
    setShowAllMessages(next);
    if (name) {
      fetchMessages(name, { overrideSince: next ? null : taskSinceRef.current });
    }
  }, [name, fetchMessages, setShowAllMessages]);

  // Mount/unmount cleanup: no automatic random address on mount
  useEffect(() => {
    return () => {
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  // Visibility and Polling:
  // Poll every 3 seconds while visible.
  // Pause completely when document is hidden.
  // Immediately refresh and resume scheduled polling when becoming visible.
  useEffect(() => {
    if (!name) return;

    let isEffectActive = true;

    const runScheduledPoll = async () => {
      if (!isEffectActive || document.visibilityState === 'hidden') {
        return;
      }
      await fetchMessages(name, { isBackgroundPoll: true });
      if (isEffectActive && !document.hidden) {
        pollTimerRef.current = window.setTimeout(runScheduledPoll, POLL_INTERVAL_MS);
      }
    };

    const handleVisibilityChange = async () => {
      const hidden = document.visibilityState === 'hidden';
      setIsDocumentHidden(hidden);

      if (hidden) {
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      } else {
        // Clear any existing timer and trigger immediate poll on resume
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        await fetchMessages(name, { isBackgroundPoll: true });
        if (isEffectActive && !document.hidden) {
          pollTimerRef.current = window.setTimeout(runScheduledPoll, POLL_INTERVAL_MS);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Initial poll schedule
    if (document.visibilityState !== 'hidden') {
      pollTimerRef.current = window.setTimeout(runScheduledPoll, POLL_INTERVAL_MS);
    }

    return () => {
      isEffectActive = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [name, fetchMessages]);

  return {
    name,
    address,
    taskSince,
    messages,
    selectedMessageId,
    isLoading,
    isPolling,
    isDocumentHidden,
    error,
    lastPolledAt,
    nextCursor,
    hasMore: Boolean(nextCursor),
    switchMailbox,
    generateRandomMailbox,
    manualRefresh,
    clearCurrentMailbox,
    deleteSingleMessage,
    loadMoreMessages,
    setSelectedMessageId,
    clearError,
    resetTaskSince,
    toggleShowAllMessages,
    showAllMessages,
  };
}
