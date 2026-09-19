import { create } from 'zustand';
import { Problem, Submission, InterviewRoom, User, CandidateInvitation, ParticipantStatus, getDefaultCodeByLanguage } from '../types';

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  runtime?: number;
  memory?: number;
  testResults?: { passed: boolean; input: string; expected: string; actual?: string }[];
}

export interface ExecutionHistoryItem {
  id: string;
  type: 'run' | 'submit';
  result: ExecutionResult;
  timestamp: string;
  language: string;
  passedCount: number;
  totalCount: number;
  runtime?: number;
  memory?: number;
  status: 'pending' | 'running' | 'success' | 'failed';
}

export interface StatusChangeNotification {
  id: string;
  oldStatus: InterviewRoom['status'];
  newStatus: InterviewRoom['status'];
  timestamp: string;
}

export interface CandidateJoinNotification {
  id: string;
  userId: string;
  name: string;
}

interface InterviewState {
  problems: Problem[];
  currentProblem: Problem | null;
  submissions: Submission[];
  deprecatedRoom: InterviewRoom | null;
  room: InterviewRoom | null;
  code: string;
  originalCode: string;
  language: string;
  isRunning: boolean;
  isSubmitting: boolean;
  lastRunResult: ExecutionResult | null;
  lastSubmissionResult: ExecutionResult | null;
  executionHistory: ExecutionHistoryItem[];
  currentUser: User | null;
  myRooms: InterviewRoom[];
  currentRoom: InterviewRoom | null;
  invitations: CandidateInvitation[];
  participants: ParticipantStatus[];
  participantsRoomId: string | null;
  /** 已经出过加入通知的候选人，同一人在同一房间只通知一次 */
  knownCandidateUserIds: string[];
  /** 首次全量快照是否已建立；建立前的在线候选人不算"新加入" */
  participantsSeeded: boolean;
  candidateJoinNotification: CandidateJoinNotification | null;
  isConnected: boolean;
  statusChangeNotification: StatusChangeNotification | null;
  setProblem: (p: Problem) => void;
  setCode: (code: string) => void;
  setLanguage: (lang: string) => void;
  setIsRunning: (running: boolean) => void;
  setIsSubmitting: (submitting: boolean) => void;
  setLastRunResult: (result: ExecutionResult | null) => void;
  setLastSubmissionResult: (result: ExecutionResult | null) => void;
  addExecutionHistory: (item: ExecutionHistoryItem) => void;
  clearExecutionHistory: () => void;
  resetOriginalCode: () => void;
  addSubmission: (s: Submission) => void;
  setRoom: (room: InterviewRoom) => void;
  setCurrentUser: (user: User) => void;
  setMyRooms: (rooms: InterviewRoom[]) => void;
  setCurrentRoom: (room: InterviewRoom | null) => void;
  setInvitations: (invitations: CandidateInvitation[]) => void;
  /** 首次进入房间建立基线快照，不触发加入通知 */
  initParticipants: (roomId: string, participants: ParticipantStatus[]) => void;
  /** 合并服务端推送/轮询快照，只对真实新加入的在线候选人产生一次通知 */
  mergeParticipants: (roomId: string, incoming: ParticipantStatus[]) => void;
  setParticipants: (participants: ParticipantStatus[]) => void;
  addInvitation: (invitation: CandidateInvitation) => void;
  updateInvitationStatus: (invitationId: string, status: string) => void;
  updateParticipant: (participant: ParticipantStatus) => void;
  dismissCandidateJoinNotification: () => void;
  setIsConnected: (connected: boolean) => void;
  setStatusChangeNotification: (notification: StatusChangeNotification | null) => void;
  resetRoom: () => void;
  setProblems: (problems: Problem[]) => void;
  addProblem: (problem: Problem) => void;
  updateProblem: (problem: Problem) => void;
  removeProblem: (problemId: string) => void;
  updateExecutionHistory: (id: string, updates: Partial<ExecutionHistoryItem>) => void;
}

/** 房间状态只能向前推进，旧快照/乱序推送不能把状态拉回去 */
const STATUS_RANK: Record<InterviewRoom['status'], number> = {
  WAITING: 0,
  ACTIVE: 1,
  COMPLETED: 2,
  CANCELLED: 3,
};

/** 后端宽限期为 45s，前端快照中暂时缺失的本地成员最多多保留一会儿 */
const LOCAL_MEMBER_TTL_MS = 60_000;

const now = () => new Date().getTime();

/** 合并单个成员字段：joinedAt 保留更早的，心跳更新的才覆盖在线状态 */
function mergeMember(local: ParticipantStatus | null, incoming: ParticipantStatus): ParticipantStatus {
  if (!local) {
    return incoming;
  }
  const localHeartbeat = local.lastHeartbeat ? new Date(local.lastHeartbeat).getTime() : 0;
  const incomingHeartbeat = incoming.lastHeartbeat ? new Date(incoming.lastHeartbeat).getTime() : 0;
  const useIncomingLiveness = incomingHeartbeat >= localHeartbeat;

  const localJoined = local.joinedAt ? new Date(local.joinedAt).getTime() : Infinity;
  const incomingJoined = incoming.joinedAt ? new Date(incoming.joinedAt).getTime() : Infinity;
  const earliestJoined = Math.min(localJoined, incomingJoined);
  const earliestJoinedIso = Number.isFinite(earliestJoined)
    ? new Date(earliestJoined).toISOString()
    : incoming.joinedAt;

  return {
    ...local,
    ...incoming,
    joinedAt: earliestJoinedIso,
    isOnline: useIncomingLiveness ? incoming.isOnline : local.isOnline,
    lastHeartbeat: useIncomingLiveness ? incoming.lastHeartbeat : local.lastHeartbeat,
  };
}

export const useInterviewStore = create<InterviewState>((set, get) => ({
  problems: [], currentProblem: null, submissions: [], deprecatedRoom: null, room: null,
  code: getDefaultCodeByLanguage('javascript'), originalCode: getDefaultCodeByLanguage('javascript'), language: 'javascript',
  isRunning: false, isSubmitting: false, lastRunResult: null, lastSubmissionResult: null,
  executionHistory: [],
  currentUser: null, myRooms: [], currentRoom: null, invitations: [],
  participants: [], participantsRoomId: null, knownCandidateUserIds: [], participantsSeeded: false,
  candidateJoinNotification: null,
  isConnected: false,
  statusChangeNotification: null,
  setProblem: (p) => set({ currentProblem: p }),
  setCode: (code) => set({ code }),
  setLanguage: (lang) => {
    const defaultCode = getDefaultCodeByLanguage(lang);
    set({
      language: lang,
      code: defaultCode,
      originalCode: defaultCode,
      lastRunResult: null,
      lastSubmissionResult: null,
      executionHistory: [],
    });
  },
  setIsRunning: (running) => set({ isRunning: running }),
  setIsSubmitting: (submitting) => set({ isSubmitting: submitting }),
  setLastRunResult: (result) => set({ lastRunResult: result }),
  setLastSubmissionResult: (result) => set({ lastSubmissionResult: result }),
  addExecutionHistory: (item) => set((state) => ({
    executionHistory: [item, ...state.executionHistory].slice(0, 20),
  })),
  clearExecutionHistory: () => set({ executionHistory: [] }),
  resetOriginalCode: () => set({ originalCode: useInterviewStore.getState().code }),
  addSubmission: (s) => set({ submissions: [s, ...useInterviewStore.getState().submissions] }),
  setRoom: (room) => set({ deprecatedRoom: room, room, currentRoom: room }),
  setCurrentUser: (user) => set({ currentUser: user }),
  setMyRooms: (rooms) => set({ myRooms: rooms }),
  setCurrentRoom: (incomingRoom) => set((state) => {
    if (!incomingRoom) {
      return { currentRoom: null, deprecatedRoom: null, room: null };
    }

    const oldRoom = state.currentRoom;
    // 同一房间、同一状态：无变化（吸收轮询与乐观更新的重复回包）
    if (oldRoom && oldRoom.id === incomingRoom.id && oldRoom.status === incomingRoom.status) {
      return { currentRoom: incomingRoom, deprecatedRoom: incomingRoom, room: incomingRoom };
    }

    // 状态回退（旧快照/乱序推送/已取消房间的延迟回包）：忽略状态但同步其他字段
    if (oldRoom && oldRoom.id === incomingRoom.id
        && STATUS_RANK[incomingRoom.status] < STATUS_RANK[oldRoom.status]) {
      const mergedRoom: InterviewRoom = { ...incomingRoom, status: oldRoom.status };
      return { currentRoom: mergedRoom, deprecatedRoom: mergedRoom, room: mergedRoom };
    }

    // 首次进入房间不产生状态变更提示，只有真实的状态推进才通知一次
    if (oldRoom && oldRoom.id === incomingRoom.id && STATUS_RANK[incomingRoom.status] > STATUS_RANK[oldRoom.status]) {
      const notification: StatusChangeNotification = {
        id: `status-change-${now()}`,
        oldStatus: oldRoom.status,
        newStatus: incomingRoom.status,
        timestamp: new Date().toISOString(),
      };
      return {
        currentRoom: incomingRoom,
        deprecatedRoom: incomingRoom,
        room: incomingRoom,
        statusChangeNotification: notification,
      };
    }

    return { currentRoom: incomingRoom, deprecatedRoom: incomingRoom, room: incomingRoom };
  }),
  setInvitations: (invitations) => set({ invitations }),
  initParticipants: (roomId, incoming) => {
    // 切换房间：丢弃旧房间的基线
    if (get().participantsRoomId !== roomId) {
      set({
        participantsRoomId: roomId,
        participants: [],
        knownCandidateUserIds: [],
        participantsSeeded: false,
        candidateJoinNotification: null,
      });
    }
    // 归一化同房间内同角色同姓名的历史重复行，合并并保留最早 joinedAt
    const byKey = new Map<string, ParticipantStatus>();
    incoming.forEach((raw) => {
      const p = { ...raw, roomId };
      const key = `${p.userRole}::${(p.userName || '').trim().toLowerCase()}`;
      const existing = byKey.get(key);
      byKey.set(key, existing ? mergeMember(existing, p) : p);
    });
    const normalized = Array.from(byKey.values());
    set({
      participants: normalized,
      // 建立基线：当前所有候选人都视为"已知"，不补弹加入通知
      knownCandidateUserIds: normalized
        .filter((p) => p.userRole === 'CANDIDATE')
        .map((p) => p.userId),
      participantsSeeded: true,
    });
  },
  mergeParticipants: (roomId, incoming) => {
    const state = get();

    // 切换了房间但还没建基线：直接按基线处理，忽略旧房间的延迟推送
    if (state.participantsRoomId !== roomId) {
      get().initParticipants(roomId, incoming);
      return;
    }

    const normalized = incoming.map((p) => ({ ...p, roomId }));
    const incomingMap = new Map<string, ParticipantStatus>();
    normalized.forEach((p) => {
      const existing = incomingMap.get(p.userId);
      incomingMap.set(p.userId, existing ? mergeMember(existing, p) : p);
    });

    // 归一化：兼容历史数据中同一成员的多行残留（userId 不稳定时）。
    // 同一房间内同角色同姓名视为同一人，合并到最早的身份下，面板不重复显示。
    const identityByKey = new Map<string, string>();
    const canonical: ParticipantStatus[] = [];
    incomingMap.forEach((p) => {
      const key = `${p.userRole}::${(p.userName || '').trim().toLowerCase()}`;
      const canonicalUserId = identityByKey.get(key);
      if (canonicalUserId === undefined) {
        identityByKey.set(key, p.userId);
        canonical.push(p);
      } else {
        const target = canonical.find((c) => c.userId === canonicalUserId);
        if (target) {
          const merged = mergeMember(target, p);
          // 保留稳定的身份ID，避免掉线重进在列表中换一行
          merged.userId = canonicalUserId;
          Object.assign(target, merged);
        }
      }
    });

    // 真实新加入的在线候选人（基线建立之后才出现）
    let joinNotification: CandidateJoinNotification | null = null;
    const knownIds = new Set(state.knownCandidateUserIds);
    if (state.participantsSeeded) {
      for (const p of canonical) {
        if (p.userRole === 'CANDIDATE' && p.isOnline && !knownIds.has(p.userId)) {
          joinNotification = {
            id: `candidate-join-${p.userId}-${now()}`,
            userId: p.userId,
            name: p.userName,
          };
          break;
        }
      }
    }
    canonical
      .filter((p) => p.userRole === 'CANDIDATE')
      .forEach((p) => knownIds.add(p.userId));

    const currentTime = now();
    const merged: ParticipantStatus[] = [];
    const mergedUserIds = new Set<string>();

    canonical.forEach((p) => {
      const local = state.participants.find((lp) => lp.userId === p.userId && lp.roomId === roomId) || null;
      merged.push(mergeMember(local, p));
      mergedUserIds.add(p.userId);
    });

    // 快照中暂时缺失的本地成员：后端有 45s 宽限期，前端也短暂保留，
    // 避免轮询/重连瞬间的空快照造成成员"短暂丢失"。
    // 同时按姓名归一匹配服务端换了身份ID的同一成员
    state.participants.forEach((local) => {
      if (local.roomId !== roomId || mergedUserIds.has(local.userId)) {
        return;
      }
      const samePersonIncoming = canonical.find((p) =>
        p.userRole === local.userRole
        && (p.userName || '').trim().toLowerCase() === (local.userName || '').trim().toLowerCase()
      );
      if (samePersonIncoming) {
        return;
      }
      const lastSeen = local.lastHeartbeat ? new Date(local.lastHeartbeat).getTime() : 0;
      if (currentTime - lastSeen <= LOCAL_MEMBER_TTL_MS) {
        merged.push(local);
      }
    });

    merged.sort((a, b) => {
      const ta = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
      const tb = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
      return ta - tb;
    });

    set({
      participants: merged,
      knownCandidateUserIds: Array.from(knownIds),
      participantsSeeded: true,
      candidateJoinNotification: joinNotification ?? state.candidateJoinNotification,
    });
  },
  // 兼容旧调用方：视为一次带合并的快照更新
  setParticipants: (participants) => {
    const roomId = get().participantsRoomId;
    if (roomId) {
      get().mergeParticipants(roomId, participants);
    } else {
      set({ participants });
    }
  },
  addInvitation: (invitation) => set((state) => ({ invitations: [...state.invitations, invitation] })),
  updateInvitationStatus: (invitationId, status) => set((state) => ({
    invitations: state.invitations.map((inv) =>
      inv.id === invitationId ? { ...inv, status: status as CandidateInvitation['status'] } : inv
    ),
  })),
  updateParticipant: (participant) => set((state) => {
    if (state.participantsRoomId !== participant.roomId) {
      return {};
    }
    const exists = state.participants.some((p) => p.userId === participant.userId);
    if (exists) {
      return {
        participants: state.participants.map((p) =>
          p.userId === participant.userId ? mergeMember(p, participant) : p
        ),
      };
    }
    return { participants: [...state.participants, participant] };
  }),
  dismissCandidateJoinNotification: () => set({ candidateJoinNotification: null }),
  setIsConnected: (connected) => set({ isConnected: connected }),
  setStatusChangeNotification: (notification) => set({ statusChangeNotification: notification }),
  resetRoom: () => set({
    currentRoom: null, deprecatedRoom: null, room: null,
    currentProblem: null,
    invitations: [],
    participants: [], participantsRoomId: null, knownCandidateUserIds: [], participantsSeeded: false,
    candidateJoinNotification: null,
    isConnected: false,
    executionHistory: [],
    lastRunResult: null,
    lastSubmissionResult: null,
    statusChangeNotification: null,
  }),
  setProblems: (problems) => set({ problems }),
  addProblem: (problem) => set((state) => ({ problems: [problem, ...state.problems] })),
  updateProblem: (problem) => set((state) => ({
    problems: state.problems.map((p) => p.id === problem.id ? problem : p),
  })),
  removeProblem: (problemId) => set((state) => ({
    problems: state.problems.filter((p) => p.id !== problemId),
  })),
  updateExecutionHistory: (id, updates) => set((state) => ({
    executionHistory: state.executionHistory.map((item) =>
      item.id === id ? { ...item, ...updates } : item
    ),
  })),
}));
