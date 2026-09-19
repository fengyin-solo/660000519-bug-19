import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CodeEditor } from './CodeEditor';
import { ProblemPanel } from './ProblemPanel';
import { CreateRoomModal } from './CreateRoomModal';
import { InvitePanel } from './InvitePanel';
import ParticipantList from './ParticipantList';
import { useInterviewStore, StatusChangeNotification } from '../store/interview';
import { getRoomStatusConfig, formatDuration, formatTime } from '../types';
import { getRoomById, updateRoomStatus } from '../services/interviewRoomService';
import { getProblemById } from '../services/problemService';
import { useRoomPresence } from '../hooks/useRoomPresence';

export const InterviewerRoomView: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const {
    currentRoom,
    currentUser,
    currentProblem,
    setCurrentRoom,
    resetRoom,
    setProblem,
    statusChangeNotification,
    setStatusChangeNotification,
  } = useInterviewStore();
  const [showInvitePanel, setShowInvitePanel] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState<string>('');
  const [localStatusNotification, setLocalStatusNotification] = useState<StatusChangeNotification | null>(null);
  const durationTimerRef = useRef<number | null>(null);
  const notificationTimerRef = useRef<number | null>(null);

  // 房间在线状态、订阅、心跳、兜底轮询全部由统一 hook 管理（全树一份）
  useRoomPresence(roomId, currentUser);

  const fetchRoomDetails = useCallback(async () => {
    if (!roomId) return;
    try {
      const data = await getRoomById(roomId);
      setCurrentRoom(data);
      if (data.problemId) {
        const problem = await getProblemById(data.problemId);
        setProblem(problem);
      }
    } catch (error) {
      console.error('Failed to fetch room details:', error);
    }
  }, [roomId, setCurrentRoom, setProblem]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setLoading(true);
      try {
        await fetchRoomDetails();
      } catch (error) {
        console.error('Failed to initialize room:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, [fetchRoomDetails]);

  const updateDuration = useCallback(() => {
    if (!currentRoom) return;
    if (currentRoom.status === 'WAITING') {
      setDuration(formatDuration(currentRoom.createdAt));
    } else if (currentRoom.status === 'ACTIVE' && currentRoom.startedAt) {
      setDuration(formatDuration(currentRoom.startedAt));
    } else if (currentRoom.status === 'COMPLETED' && currentRoom.startedAt && currentRoom.endedAt) {
      setDuration(formatDuration(currentRoom.startedAt, currentRoom.endedAt));
    }
  }, [currentRoom]);

  useEffect(() => {
    updateDuration();
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
    }
    if (currentRoom && (currentRoom.status === 'WAITING' || currentRoom.status === 'ACTIVE')) {
      durationTimerRef.current = window.setInterval(updateDuration, 1000);
    }
    return () => {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
      }
    };
  }, [currentRoom?.status, currentRoom?.createdAt, currentRoom?.startedAt, currentRoom?.endedAt, updateDuration]);

  useEffect(() => {
    if (statusChangeNotification) {
      setLocalStatusNotification(statusChangeNotification);
      setStatusChangeNotification(null);
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
      notificationTimerRef.current = window.setTimeout(() => {
        setLocalStatusNotification(null);
        notificationTimerRef.current = null;
      }, 5000);
    }
    return () => {
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
    };
  }, [statusChangeNotification, setStatusChangeNotification]);

  const getStatusDurationLabel = () => {
    if (!currentRoom) return '';
    switch (currentRoom.status) {
      case 'WAITING': return `已等待 ${duration}`;
      case 'ACTIVE': return `已进行 ${duration}`;
      case 'COMPLETED': return `面试时长 ${duration}`;
      default: return '';
    }
  };

  const closeStatusNotification = () => {
    setLocalStatusNotification(null);
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
      notificationTimerRef.current = null;
    }
  };

  const handleStartInterview = async () => {
    if (!currentRoom) return;
    try {
      const updatedRoom = await updateRoomStatus(currentRoom.id, 'ACTIVE');
      setCurrentRoom(updatedRoom);
    } catch (error) {
      console.error('Failed to start interview:', error);
    }
  };

  const handleEndInterview = async () => {
    if (!currentRoom) return;
    try {
      const updatedRoom = await updateRoomStatus(currentRoom.id, 'COMPLETED');
      setCurrentRoom(updatedRoom);
    } catch (error) {
      console.error('Failed to end interview:', error);
    }
  };

  const handleBack = () => {
    resetRoom();
    navigate('/');
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0d0d0d',
      }}>
        <div style={{ color: '#fff', fontSize: '16px' }}>加载中...</div>
      </div>
    );
  }

  if (!currentRoom) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0d0d0d',
        flexDirection: 'column',
        gap: '16px',
      }}>
        <div style={{ color: '#f44336', fontSize: '16px' }}>房间不存在</div>
        <button
          onClick={handleBack}
          style={{
            padding: '10px 24px',
            background: '#2196f3',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}>
          返回首页
        </button>
      </div>
    );
  }

  if (!currentProblem) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0d0d0d',
        flexDirection: 'column',
        gap: '16px',
      }}>
        <div style={{ color: '#ff9800', fontSize: '16px' }}>题目加载失败，请稍后重试</div>
        <button
          onClick={handleBack}
          style={{
            padding: '10px 24px',
            background: '#2196f3',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}>
          返回首页
        </button>
      </div>
    );
  }

  const statusConfig = currentRoom ? getRoomStatusConfig(currentRoom.status) : null;

  return (
    <>
      <style>{`
        @keyframes slideInDown {
          from {
            transform: translateY(-100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes pulse-ring {
          0% {
            transform: scale(0.8);
            opacity: 1;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.5;
          }
          100% {
            transform: scale(0.8);
            opacity: 1;
          }
        }
        @keyframes statusBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes statusPulse {
          0%, 100% {
            box-shadow: 0 0 8px currentColor;
          }
          50% {
            box-shadow: 0 0 20px currentColor, 0 0 30px currentColor;
          }
        }
        .status-notification {
          animation: slideInDown 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        }
        .status-indicator-pulse {
          animation: statusPulse 2s ease-in-out infinite;
        }
        .status-blink {
          animation: statusBlink 1.5s ease-in-out infinite;
        }
      `}</style>

      {localStatusNotification && (
        <div
          className="status-notification"
          style={{
            position: 'fixed',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'linear-gradient(135deg, ' + getRoomStatusConfig(localStatusNotification.newStatus).color + ', ' + getRoomStatusConfig(localStatusNotification.newStatus).color + 'dd)',
            color: '#fff',
            padding: '16px 28px',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            minWidth: '360px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
          }}
        >
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
          }}>
            {getRoomStatusConfig(localStatusNotification.newStatus).icon}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', opacity: 0.9, marginBottom: '2px' }}>
              {getRoomStatusConfig(localStatusNotification.oldStatus).label} → {getRoomStatusConfig(localStatusNotification.newStatus).label}
            </div>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>
              面试状态已变更
            </div>
            <div style={{ fontSize: '13px', opacity: 0.9, marginTop: '2px' }}>
              {getRoomStatusConfig(localStatusNotification.newStatus).description}
            </div>
          </div>
          <button
            onClick={closeStatusNotification}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px 8px',
              opacity: 0.8,
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
          >
            ×
          </button>
        </div>
      )}

    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', background: '#0d0d0d' }}>
      <div style={{
        width: '56px',
        background: '#1a1a1a',
        borderRight: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 0',
        gap: '16px',
      }}>
        <button
          onClick={handleBack}
          title="返回房间列表"
          style={{
            width: '40px', height: '40px',
            background: 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '20px',
            borderRadius: '8px',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          ←
        </button>
        <button
          onClick={() => setShowInvitePanel(!showInvitePanel)}
          title={showInvitePanel ? '隐藏邀请面板' : '显示邀请面板'}
          style={{
            width: '40px', height: '40px',
            background: showInvitePanel ? '#2196f3' : 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '18px',
            borderRadius: '8px',
          }}
          onMouseEnter={(e) => !showInvitePanel && (e.currentTarget.style.background = '#333')}
          onMouseLeave={(e) => !showInvitePanel && (e.currentTarget.style.background = 'transparent')}>
          👥
        </button>
      </div>

      {showInvitePanel && (
        <InvitePanel roomId={currentRoom.id} roomCode={currentRoom.roomCode} />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          background: '#1e1e1e',
          borderBottom: '1px solid #333',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
            <h2 style={{ color: '#fff', margin: 0, fontSize: '18px', whiteSpace: 'nowrap' }}>{currentRoom.title}</h2>
            {statusConfig && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '6px 14px',
                borderRadius: '20px',
                background: statusConfig.bgColor,
                border: '1px solid ' + statusConfig.color + '40',
              }}>
                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: statusConfig.color,
                  color: statusConfig.color,
                }} className={(currentRoom.status === 'WAITING' || currentRoom.status === 'ACTIVE') ? 'status-indicator-pulse' : ''} />
                <span style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: statusConfig.color,
                }}>
                  {statusConfig.icon} {statusConfig.label}
                </span>
              </div>
            )}
            {statusConfig && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: '#666' }}>⏱</span>
                <span style={{
                  fontSize: '12px',
                  color: statusConfig.color,
                  fontWeight: 500,
                  fontFamily: 'monospace',
                }} className={currentRoom.status === 'ACTIVE' ? 'status-blink' : ''}>
                  {getStatusDurationLabel()}
                </span>
              </div>
            )}
            {currentRoom.startedAt && (
              <div style={{ fontSize: '11px', color: '#666' }}>
                开始于 {formatTime(currentRoom.startedAt)}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ color: '#888', fontSize: '13px' }}>
              房间码: <span style={{ color: '#4caf50', fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: '1px' }}>{currentRoom.roomCode}</span>
            </div>
            {currentRoom.status === 'WAITING' && (
              <button
                onClick={handleStartInterview}
                style={{
                  padding: '10px 24px',
                  background: 'linear-gradient(135deg, #4caf50, #45a049)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                  boxShadow: '0 4px 12px rgba(76, 175, 80, 0.3)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(76, 175, 80, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.3)';
                }}>
                ▶ 开始面试
              </button>
            )}
            {currentRoom.status === 'ACTIVE' && (
              <button
                onClick={handleEndInterview}
                style={{
                  padding: '10px 24px',
                  background: 'linear-gradient(135deg, #f44336, #e53935)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                  boxShadow: '0 4px 12px rgba(244, 67, 54, 0.3)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(244, 67, 54, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(244, 67, 54, 0.3)';
                }}>
                ⏹ 结束面试
              </button>
            )}
            {currentRoom.status === 'COMPLETED' && (
              <div style={{
                padding: '8px 16px',
                background: 'rgba(33, 150, 243, 0.1)',
                border: '1px solid rgba(33, 150, 243, 0.3)',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#2196f3',
                fontWeight: 500,
              }}>
                面试已完成
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <ProblemPanel problem={currentProblem} />
          <CodeEditor
            disabled={currentRoom.status !== 'ACTIVE'}
          />
        </div>
      </div>

      <div style={{
        width: '320px',
        background: '#1a1a1a',
        borderLeft: '1px solid #333',
        padding: '16px',
        overflowY: 'auto',
      }}>
        <ParticipantList roomId={currentRoom.id} />
      </div>

      <CreateRoomModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => setIsCreateModalOpen(false)}
      />
    </div>
    </>
  );
};
