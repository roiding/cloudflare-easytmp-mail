// @vitest-environment jsdom
import './setup';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMailbox } from '../src/hooks/useMailbox';
import { apiClient } from '../src/api/client';
import {
  createMockListResponse,
  createMockMessageSummary,
  createMockRandomAddress,
} from './helpers/test-utils';

describe('useMailbox polling and lifecycle state machine', () => {
  const baselineServerTime = 1793671200000;

  beforeEach(() => {
    vi.useFakeTimers({ now: baselineServerTime });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('starts in idle state on mount without calling random address API or listing messages', async () => {
    const randomSpy = vi.spyOn(apiClient, 'getRandomAddress');
    const listSpy = vi.spyOn(apiClient, 'listMessages');

    const { result } = renderHook(() => useMailbox());

    await act(async () => {
      await Promise.resolve();
    });

    // Zero API calls on initial mount
    expect(randomSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();

    // Idle initial state
    expect(result.current.name).toBe('');
    expect(result.current.address).toBe('');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isPolling).toBe(false);
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.taskSince).toBeNull();
  });

  it('loads all unexpired messages upon manual input and view, then starts 3s automatic polling', async () => {
    const randomSpy = vi.spyOn(apiClient, 'getRandomAddress');
    const msg1 = createMockMessageSummary({
      id: 'msg-1',
      receivedAt: baselineServerTime + 1000,
      subject: 'Message 1',
    });
    const msg2 = createMockMessageSummary({
      id: 'msg-2',
      receivedAt: baselineServerTime + 2000,
      subject: 'Message 2',
    });

    const listSpy = vi
      .spyOn(apiClient, 'listMessages')
      // 1. First fetch right after manual switch
      .mockResolvedValueOnce(
        createMockListResponse([msg1], null, 'manualbox', baselineServerTime + 500),
      )
      // 2. Poll round 1 at 3s: returns msg1 + new msg2
      .mockResolvedValueOnce(
        createMockListResponse([msg1, msg2], null, 'manualbox', baselineServerTime + 3500),
      )
      // 3. Poll round 2 at 6s: returns msg1 and msg2 again
      .mockResolvedValueOnce(
        createMockListResponse([msg1, msg2], null, 'manualbox', baselineServerTime + 6500),
      );

    const { result } = renderHook(() => useMailbox());

    await act(async () => {
      await Promise.resolve();
    });

    // Mount does not trigger random API
    expect(randomSpy).not.toHaveBeenCalled();

    // User inputs mailbox and views
    await act(async () => {
      const switched = await result.current.switchMailbox('manualbox');
      expect(switched).toBe(true);
      await Promise.resolve();
    });

    expect(result.current.name).toBe('manualbox');
    expect(result.current.address).toBe('manualbox@cottage.dpdns.org');
    expect(result.current.showAllMessages).toBe(true);
    expect(result.current.messages).toHaveLength(1);

    // Initial manual query queries ALL unexpired messages (since: undefined)
    expect(listSpy).toHaveBeenNthCalledWith(
      1,
      'manualbox',
      expect.objectContaining({ since: undefined }),
    );

    // Advance 3 seconds for Poll round 1
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(listSpy).toHaveBeenNthCalledWith(
      2,
      'manualbox',
      expect.objectContaining({ since: undefined }),
    );
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages.map((m) => m.id)).toEqual(['msg-2', 'msg-1']);

    // Advance another 3 seconds for Poll round 2
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(listSpy).toHaveBeenNthCalledWith(
      3,
      'manualbox',
      expect.objectContaining({ since: undefined }),
    );
    expect(result.current.messages).toHaveLength(2);
  });

  it('triggers random API strictly upon explicit generateRandomMailbox button action', async () => {
    const randomSpy = vi
      .spyOn(apiClient, 'getRandomAddress')
      .mockResolvedValue(createMockRandomAddress('randbox', baselineServerTime));

    const listSpy = vi
      .spyOn(apiClient, 'listMessages')
      .mockResolvedValue(createMockListResponse([], null, 'randbox', baselineServerTime));

    const { result } = renderHook(() => useMailbox());

    await act(async () => {
      await Promise.resolve();
    });

    expect(randomSpy).not.toHaveBeenCalled();

    // User explicitly clicks random button
    await act(async () => {
      await result.current.generateRandomMailbox();
      await Promise.resolve();
    });

    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(result.current.name).toBe('randbox');
    expect(result.current.address).toBe('randbox@cottage.dpdns.org');
    expect(result.current.taskSince).toBe(baselineServerTime);
    expect(listSpy).toHaveBeenCalledWith(
      'randbox',
      expect.objectContaining({ since: baselineServerTime }),
    );
  });

  it('reconciles first-page polling against authoritative server response on external deletion/expiration', async () => {
    const msg1 = createMockMessageSummary({
      id: 'msg-1',
      receivedAt: baselineServerTime + 1000,
      subject: 'Message 1',
    });
    const msg2 = createMockMessageSummary({
      id: 'msg-2',
      receivedAt: baselineServerTime + 2000,
      subject: 'Message 2',
    });

    vi.spyOn(apiClient, 'listMessages')
      // 1. Initial fetch has both messages
      .mockResolvedValueOnce(
        createMockListResponse([msg1, msg2], null, 'reconcilebox', baselineServerTime + 500),
      )
      // 2. Poll round: server dropped msg1 externally (e.g. expired or deleted by another client)
      .mockResolvedValueOnce(
        createMockListResponse([msg2], null, 'reconcilebox', baselineServerTime + 3500),
      );

    const { result } = renderHook(() => useMailbox());

    await act(async () => {
      await result.current.switchMailbox('reconcilebox');
      await Promise.resolve();
    });

    expect(result.current.messages).toHaveLength(2);

    // Advance 3s to trigger next poll
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    // Reconcile must drop msg1, keeping only authoritative msg2
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('msg-2');
  });

  it('pauses polling when page is hidden and immediately refreshes when restored to visible', async () => {
    const listSpy = vi
      .spyOn(apiClient, 'listMessages')
      .mockResolvedValue(createMockListResponse([], null, 'box1', baselineServerTime));

    const { result } = renderHook(() => useMailbox());

    await act(async () => {
      await result.current.switchMailbox('box1');
      await Promise.resolve();
    });

    const callsBeforeHide = listSpy.mock.calls.length;

    // Simulate document becoming hidden
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Advance 9 seconds while hidden
    await act(async () => {
      vi.advanceTimersByTime(9000);
      await Promise.resolve();
    });

    // No new poll calls should have been made while hidden
    expect(listSpy.mock.calls.length).toBe(callsBeforeHide);

    // Simulate document becoming visible again
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    // Becoming visible triggers an immediate fetch
    expect(listSpy.mock.calls.length).toBe(callsBeforeHide + 1);
  });

  it('manual refresh uses authoritative server time from health, not local clock', async () => {
    vi.spyOn(apiClient, 'getRandomAddress').mockResolvedValue(
      createMockRandomAddress('box1', baselineServerTime),
    );
    const listSpy = vi
      .spyOn(apiClient, 'listMessages')
      .mockResolvedValue(createMockListResponse([], null, 'box1', baselineServerTime));

    const serverHealthTime = baselineServerTime + 45000;
    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({
      status: 'ok',
      service: 'easytmp-mail',
      apiVersion: '1',
      serverTime: serverHealthTime,
    });

    const { result } = renderHook(() => useMailbox());

    // Generate random to set taskSince
    await act(async () => {
      await result.current.generateRandomMailbox();
      await Promise.resolve();
    });

    expect(result.current.taskSince).toBe(baselineServerTime);

    // Advance local clock arbitrarily to simulate clock drift
    vi.setSystemTime(baselineServerTime + 999999);

    // Manual refresh
    await act(async () => {
      await result.current.manualRefresh();
      await Promise.resolve();
    });

    // Task since MUST be updated to serverHealthTime, NOT the drifted local clock
    expect(result.current.taskSince).toBe(serverHealthTime);
    expect(listSpy).toHaveBeenLastCalledWith(
      'box1',
      expect.objectContaining({ since: serverHealthTime }),
    );
  });

  it('deleteSingleMessage performs deletion directly without redundant confirmation in hook', async () => {
    const msg = createMockMessageSummary({ id: 'msg-del-1', subject: 'Delete Me' });
    vi.spyOn(apiClient, 'listMessages').mockResolvedValue(
      createMockListResponse([msg], null, 'delbox', baselineServerTime),
    );
    const deleteSpy = vi.spyOn(apiClient, 'deleteMessage').mockResolvedValue({
      id: 'msg-del-1',
      deleted: true,
      serverTime: baselineServerTime,
    });
    const confirmSpy = vi.spyOn(window, 'confirm');

    const { result } = renderHook(() => useMailbox());
    await act(async () => {
      await result.current.switchMailbox('delbox');
      await Promise.resolve();
    });

    expect(result.current.messages).toHaveLength(1);

    await act(async () => {
      const success = await result.current.deleteSingleMessage('msg-del-1');
      expect(success).toBe(true);
      await Promise.resolve();
    });

    // Confirmation must NOT be invoked inside useMailbox (only in MessageDetail component)
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith('msg-del-1');
    expect(result.current.messages).toHaveLength(0);
  });
});
