import { useEffect, useRef } from 'react';
import { getRoomParticipants, heartbeat } from '../services/interviewRoomService';
import { connect, disconnect, subscribeParticipants, subscribeRoomStatus, sendHeartbeat } from '../services/websocketService';
import { useInterviewStore } from '../store/interview';
import type { User } from '../types';

const HTTP_HEARTBEAT_INTERVAL_MS = 30_000;
const WS_HEARTBEAT_INTERVAL_MS = 30_000;
/** WebSocket 兜底轮询：仅用于合并快照，不承担状态变更的即时通知 */
const FALLBACK_POLL_INTERVAL_MS = 10_000;

/**
 * 房间在线状态与房间状态的唯一数据源：
 * - 进入房间建立一次 STOMP 连接、一组订阅，组件树内不再重复连接
 * - WS 推送为主，低频 HTTP 轮询兜底，所有快照都经 store 合并去重
 * - 真实加入/状态变化才会在 store 中产生一次通知
 */
export function useRoomPresence(roomId: string | undefined, currentUser: User | null): void {
  const initParticipantsRef = useRef(useInterviewStore.getState().initParticipants);
  initParticipantsRef.current = useInterviewStore.getState().initParticipants;
  const mergeParticipantsRef = useRef(useInterviewStore.getState().mergeParticipants);
  mergeParticipantsRef.current = useInterviewStore.getState().mergeParticipants;
  const setCurrentRoomRef = useRef(useInterviewStore.getState().setCurrentRoom);
  setCurrentRoomRef.current = useInterviewStore.getState().setCurrentRoom;

  useEffect(() => {
    if (!roomId || !currentUser) {
      return;
    }

    let mounted = true;
    let unsubscribeParticipants: (() => void) | null = null;
    let unsubscribeRoomStatus: (() => void) | null = null;
    let httpHeartbeatTimer: number | null = null;
    let wsHeartbeatTimer: number | null = null;
    let pollTimer: number | null = null;

    const init = async () => {
      // 1. 先拉一次全量快照建立基线（不弹加入通知）
      try {
        const data = await getRoomParticipants(roomId);
        if (mounted) {
          initParticipantsRef.current(roomId, data);
        }
      } catch (error) {
        console.error('Failed to fetch participants:', error);
      }

      if (!mounted) {
        return;
      }

      // 2. 建立唯一的 STOMP 连接并订阅（连接成功后才绑定，重连由服务层自动恢复）
      try {
        await connect(roomId, currentUser);
        if (!mounted) {
          return;
        }
        useInterviewStore.getState().setIsConnected(true);

        unsubscribeParticipants = subscribeParticipants(roomId, (data) => {
          if (mounted) {
            mergeParticipantsRef.current(roomId, data);
          }
        });

        unsubscribeRoomStatus = subscribeRoomStatus(roomId, (room) => {
          if (mounted && room) {
            setCurrentRoomRef.current(room);
          }
        });

        // 订阅建立后再拉一次最新快照，填补"首次快照之后、订阅之前"的事件空档，
        // 避免切换页面返回后列表短暂滞后
        try {
          const latest = await getRoomParticipants(roomId);
          if (mounted) {
            mergeParticipantsRef.current(roomId, latest);
          }
        } catch (error) {
          console.error('Failed to refresh participants after subscribe:', error);
        }
      } catch (error) {
        console.error('Failed to connect WebSocket:', error);
      }

      if (!mounted) {
        return;
      }

      // 3. 心跳与兜底轮询（整个房间视图内只有这一份）
      httpHeartbeatTimer = window.setInterval(async () => {
        if (!mounted) return;
        try {
          await heartbeat(roomId, currentUser.id);
        } catch (error) {
          console.error('Failed to send HTTP heartbeat:', error);
        }
      }, HTTP_HEARTBEAT_INTERVAL_MS);

      wsHeartbeatTimer = window.setInterval(() => {
        if (mounted) {
          sendHeartbeat(roomId, currentUser);
        }
      }, WS_HEARTBEAT_INTERVAL_MS);

      pollTimer = window.setInterval(async () => {
        if (!mounted) return;
        try {
          const data = await getRoomParticipants(roomId);
          if (mounted) {
            mergeParticipantsRef.current(roomId, data);
          }
        } catch (error) {
          console.error('Failed to poll participants:', error);
        }
      }, FALLBACK_POLL_INTERVAL_MS);
    };

    init();

    return () => {
      mounted = false;
      if (httpHeartbeatTimer !== null) window.clearInterval(httpHeartbeatTimer);
      if (wsHeartbeatTimer !== null) window.clearInterval(wsHeartbeatTimer);
      if (pollTimer !== null) window.clearInterval(pollTimer);
      if (unsubscribeParticipants) unsubscribeParticipants();
      if (unsubscribeRoomStatus) unsubscribeRoomStatus();
      disconnect();
      useInterviewStore.getState().setIsConnected(false);
    };
  }, [roomId, currentUser]);
}
