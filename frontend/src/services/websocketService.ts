import SockJS from 'sockjs-client';
import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import type { User, InterviewRoom, ParticipantStatus } from '../types';

interface RawEnvelope {
  type?: string;
  payload?: unknown;
}

interface ParticipantSubscription {
  roomId: string;
  callback: (participants: ParticipantStatus[]) => void;
  stompSubscription: StompSubscription | null;
}

interface RoomStatusSubscription {
  roomId: string;
  callback: (room: InterviewRoom) => void;
  stompSubscription: StompSubscription | null;
}

let stompClient: Client | null = null;
let connectedRoomId: string | null = null;
let connectPromise: Promise<void> | null = null;

const participantSubscriptions: ParticipantSubscription[] = [];
const roomStatusSubscriptions: RoomStatusSubscription[] = [];

function unwrapPayload(message: IMessage): unknown {
  const data = JSON.parse(message.body) as RawEnvelope | unknown;
  if (data && typeof data === 'object' && 'payload' in data) {
    return (data as RawEnvelope).payload;
  }
  return data;
}

function subscribeParticipantOnBroker(sub: ParticipantSubscription): void {
  if (!stompClient || !stompClient.connected || sub.stompSubscription) {
    return;
  }
  sub.stompSubscription = stompClient.subscribe(
    `/topic/room/${sub.roomId}/participants`,
    (message: IMessage) => {
      try {
        sub.callback(unwrapPayload(message) as ParticipantStatus[]);
      } catch (e) {
        console.error('Failed to parse participants message:', e);
      }
    }
  );
}

function subscribeRoomStatusOnBroker(sub: RoomStatusSubscription): void {
  if (!stompClient || !stompClient.connected || sub.stompSubscription) {
    return;
  }
  sub.stompSubscription = stompClient.subscribe(
    `/topic/room/${sub.roomId}/status`,
    (message: IMessage) => {
      try {
        sub.callback(unwrapPayload(message) as InterviewRoom);
      } catch (e) {
        console.error('Failed to parse room status message:', e);
      }
    }
  );
}

function rebindAllSubscriptions(): void {
  participantSubscriptions.forEach((sub) => {
    sub.stompSubscription = null;
    subscribeParticipantOnBroker(sub);
  });
  roomStatusSubscriptions.forEach((sub) => {
    sub.stompSubscription = null;
    subscribeRoomStatusOnBroker(sub);
  });
}

/**
 * 建立到房间的 STOMP 连接。
 * 同一房间的重复调用复用同一条连接；切换房间则先断开旧连接。
 * STOMP 自动重连后所有订阅会自动恢复。
 */
export function connect(roomId: string, user: User): Promise<void> {
  if (stompClient && connectedRoomId === roomId && connectPromise) {
    return connectPromise;
  }

  disconnect();

  connectedRoomId = roomId;

  connectPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const client = new Client({
      webSocketFactory: () => new SockJS('http://localhost:8080/ws/interview'),
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      connectHeaders: {
        roomId,
        userId: user.id,
        userName: user.name,
        userRole: user.role,
      },
    });

    client.onConnect = () => {
      // 每次（重新）连上后重新绑定订阅，避免重连后收不到推送
      rebindAllSubscriptions();
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    client.onStompError = (frame) => {
      const error = new Error(frame.headers['message'] || 'WebSocket connection error');
      if (!settled) {
        settled = true;
        reject(error);
      }
      console.error('STOMP error:', error.message);
    };

    client.onWebSocketClose = () => {
      // 底层连接断开：标记需要在重连后重新订阅（onConnect 中会处理）
      participantSubscriptions.forEach((sub) => { sub.stompSubscription = null; });
      roomStatusSubscriptions.forEach((sub) => { sub.stompSubscription = null; });
    };

    stompClient = client;
    client.activate();
  });

  return connectPromise;
}

export function disconnect(): void {
  participantSubscriptions.forEach((sub) => {
    if (sub.stompSubscription) {
      try { sub.stompSubscription.unsubscribe(); } catch { /* ignore */ }
    }
    sub.stompSubscription = null;
  });
  participantSubscriptions.length = 0;

  roomStatusSubscriptions.forEach((sub) => {
    if (sub.stompSubscription) {
      try { sub.stompSubscription.unsubscribe(); } catch { /* ignore */ }
    }
    sub.stompSubscription = null;
  });
  roomStatusSubscriptions.length = 0;

  if (stompClient) {
    try {
      stompClient.deactivate();
    } catch { /* ignore */ }
    stompClient = null;
  }
  connectedRoomId = null;
  connectPromise = null;
}

export function subscribeParticipants(
  roomId: string,
  callback: (participants: ParticipantStatus[]) => void
): () => void {
  const sub: ParticipantSubscription = { roomId, callback, stompSubscription: null };
  participantSubscriptions.push(sub);
  subscribeParticipantOnBroker(sub);

  return () => {
    const index = participantSubscriptions.indexOf(sub);
    if (index >= 0) {
      participantSubscriptions.splice(index, 1);
    }
    if (sub.stompSubscription) {
      try { sub.stompSubscription.unsubscribe(); } catch { /* ignore */ }
    }
  };
}

export function subscribeRoomStatus(
  roomId: string,
  callback: (room: InterviewRoom) => void
): () => void {
  const sub: RoomStatusSubscription = { roomId, callback, stompSubscription: null };
  roomStatusSubscriptions.push(sub);
  subscribeRoomStatusOnBroker(sub);

  return () => {
    const index = roomStatusSubscriptions.indexOf(sub);
    if (index >= 0) {
      roomStatusSubscriptions.splice(index, 1);
    }
    if (sub.stompSubscription) {
      try { sub.stompSubscription.unsubscribe(); } catch { /* ignore */ }
    }
  };
}

export function sendHeartbeat(roomId: string, user: User): void {
  if (!stompClient || !stompClient.connected) {
    return;
  }

  const headers = {
    roomId,
    userId: user.id,
    userName: user.name,
    userRole: user.role,
  };

  stompClient.publish({
    destination: `/app/heartbeat`,
    headers,
    body: JSON.stringify({
      type: 'HEARTBEAT',
      payload: headers,
    }),
  });
}
