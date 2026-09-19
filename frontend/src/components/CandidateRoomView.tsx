import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRoomById } from '../services/interviewRoomService';
import { useInterviewStore, StatusChangeNotification } from '../store/interview';
import { ProblemPanel } from './ProblemPanel';
import { CodeEditor } from './CodeEditor';
import { getRoomStatusConfig, formatDuration, formatTime } from '../types';
import { getProblemById } from '../services/problemService';
import { useRoomPresence } from '../hooks/useRoomPresence';

const CandidateRoomView: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const {
    currentRoom,
    currentUser,
    currentProblem,
    participants,
    setCurrentRoom,
    resetRoom,
    setProblem,
    statusChangeNotification,
    setStatusChangeNotification,
  } = useInterviewStore();
  const [loading, setLoading] = useState(true);
  const [participantsPanelOpen, setParticipantsPanelOpen] = useState(false);
  const [problemPanelWidth, setProblemPanelWidth] = useState(380);
  const [isDragging, setIsDragging] = useState(false);
  const [duration, setDuration] = useState<string>('');
  const [localStatusNotification, setLocalStatusNotification] = useState<StatusChangeNotification | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const minPanelWidth = 300;
  const maxPanelWidth = 600;
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

  const handleBack = () => {
    resetRoom();
    navigate('/');
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left - 56;
      setProblemPanelWidth(Math.min(Math.max(newWidth, minPanelWidth), maxPanelWidth));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, minPanelWidth, maxPanelWidth]);

  const onlineCount = participants.filter(p => p.isOnline).length;

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0d0d0d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'sans-serif',
      }}>
        <div style={{ color: '#fff', fontSize: '16px' }}>加载中...</div>
      </div>
    );
  }

  if (!currentRoom) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0d0d0d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'sans-serif',
      }}>
        <div style={{
          background: '#1e1e1e',
          borderRadius: '8px',
          padding: '32px',
          textAlign: 'center',
          border: '1px solid #333',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ color: '#fff', margin: '0 0 8px 0' }}>房间不存在</h2>
          <p style={{ color: '#888', margin: '0 0 24px 0' }}>请检查链接是否正确</p>
          <button
            onClick={handleBack}
            style={{
              padding: '10px 24px',
              background: '#2196f3',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
            }}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  if (!currentProblem) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0d0d0d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'sans-serif',
      }}>
        <div style={{
          background: '#1e1e1e',
          borderRadius: '8px',
          padding: '32px',
          textAlign: 'center',
          border: '1px solid #333',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
          <h2 style={{ color: '#fff', margin: '0 0 8px 0' }}>题目加载中...</h2>
          <p style={{ color: '#888', margin: '0 0 24px 0' }}>请稍候</p>
          <button
            onClick={handleBack}
            style={{
              padding: '10px 24px',
              background: '#2196f3',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
            }}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const statusConfig = getRoomStatusConfig(currentRoom.status);

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
        @keyframes statusPulse {
          0%, 100% {
            box-shadow: 0 0 8px currentColor;
          }
          50% {
            box-shadow: 0 0 20px currentColor, 0 0 30px currentColor;
          }
        }
        @keyframes statusBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
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

    <div ref={containerRef} style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', background: '#0d0d0d', userSelect: isDragging ? 'none' : 'auto' }}>
      <div style={{
        width: '56px',
        background: '#1a1a1a',
        borderRight: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: '8px',
      }}>
        <button
          onClick={handleBack}
          title="返回"
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

        <div style={{ width: '32px', height: '1px', background: '#333', margin: '4px 0' }} />

        <button
          onClick={() => setParticipantsPanelOpen(!participantsPanelOpen)}
          title={`参与者 (${onlineCount} 在线)`}
          style={{
            width: '40px', height: '40px',
            background: participantsPanelOpen ? '#333' : 'transparent',
            border: 'none',
            color: participantsPanelOpen ? '#4caf50' : '#fff',
            cursor: 'pointer',
            fontSize: '18px',
            borderRadius: '8px',
            position: 'relative',
          }}
          onMouseEnter={(e) => { if (!participantsPanelOpen) e.currentTarget.style.background = '#333'; }}
          onMouseLeave={(e) => { if (!participantsPanelOpen) e.currentTarget.style.background = 'transparent'; }}>
          👥
          {onlineCount > 0 && (
            <span style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              minWidth: '16px',
              height: '16px',
              padding: '0 4px',
              background: '#4caf50',
              color: '#fff',
              fontSize: '10px',
              fontWeight: 'bold',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {onlineCount}
            </span>
          )}
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{
          background: '#1e1e1e',
          borderBottom: '1px solid #333',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1, minWidth: 0 }}>
            <h2 style={{ color: '#fff', margin: 0, fontSize: '18px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentRoom.title}</h2>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: statusConfig.bgColor,
              border: '1px solid ' + statusConfig.color + '40',
              flexShrink: 0,
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
                whiteSpace: 'nowrap',
              }}>
                {statusConfig.icon} {statusConfig.label}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              <span style={{
                fontSize: '12px',
                color: statusConfig.color,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}>
                {statusConfig.description}
              </span>
              <div style={{ width: '1px', height: '16px', background: '#333' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: '#666' }}>⏱</span>
                <span style={{
                  fontSize: '12px',
                  color: statusConfig.color,
                  fontWeight: 500,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }} className={currentRoom.status === 'ACTIVE' ? 'status-blink' : ''}>
                  {getStatusDurationLabel()}
                </span>
              </div>
            </div>
            {currentRoom.startedAt && (
              <div style={{ fontSize: '11px', color: '#666', whiteSpace: 'nowrap', flexShrink: 0 }}>
                开始于 {formatTime(currentRoom.startedAt)}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
            <div style={{ color: '#888', fontSize: '13px', whiteSpace: 'nowrap' }}>
              房间码: <span style={{ color: '#4caf50', fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: '1px' }}>{currentRoom.roomCode}</span>
            </div>
            {currentRoom.status === 'COMPLETED' && (
              <div style={{
                padding: '8px 16px',
                background: 'rgba(33, 150, 243, 0.1)',
                border: '1px solid rgba(33, 150, 243, 0.3)',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#2196f3',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}>
                面试已完成
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          <div style={{ width: problemPanelWidth, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <ProblemPanel problem={currentProblem} />
          </div>

          <div
            onMouseDown={handleMouseDown}
            style={{
              width: '4px',
              background: isDragging ? '#2196f3' : 'transparent',
              cursor: 'col-resize',
              flexShrink: 0,
              transition: 'background 0.15s',
              position: 'relative',
            }}
            onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.background = '#555'; }}
            onMouseLeave={(e) => { if (!isDragging) e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: '20px',
              height: '40px',
              borderRadius: '4px',
              background: isDragging ? '#2196f3' : '#333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
            }}>
              <div style={{ width: '2px', height: '16px', background: '#666', borderRadius: '1px' }} />
              <div style={{ width: '2px', height: '16px', background: '#666', borderRadius: '1px' }} />
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
            <CodeEditor
              disabled={currentRoom.status !== 'ACTIVE'}
            />
          </div>
        </div>
      </div>

      <div style={{
        width: participantsPanelOpen ? '280px' : '0',
        background: '#1a1a1a',
        borderLeft: participantsPanelOpen ? '1px solid #333' : 'none',
        overflow: 'hidden',
        transition: 'width 0.25s ease, border-left 0.25s ease',
        flexShrink: 0,
      }}>
        <div style={{
          padding: '16px',
          width: '280px',
          height: '100%',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h4 style={{
              margin: 0,
              fontSize: '14px',
              fontWeight: 500,
              color: '#999',
            }}>
              参与者 ({participants.length})
            </h4>
            <button
              onClick={() => setParticipantsPanelOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#888',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '4px',
                borderRadius: '4px',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#333'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888'; }}
            >
              ×
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {participants.map((participant) => {
              const isSelf = currentUser && participant.userId === currentUser.id;
              const isInterviewer = participant.userRole === 'INTERVIEWER';

              return (
                <div
                  key={participant.userId}
                  style={{
                    padding: '10px',
                    backgroundColor: isSelf ? '#2a3f4f' : '#2a2a2a',
                    borderRadius: '6px',
                    border: isSelf ? '1px solid #2196f3' : '1px solid transparent',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '6px',
                  }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: participant.isOnline ? '#4caf50' : '#666',
                      boxShadow: participant.isOnline ? '0 0 6px #4caf50' : 'none',
                      flexShrink: 0,
                    }} />
                    <span style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 500,
                      backgroundColor: isInterviewer ? '#9c27b0' : '#2196f3',
                      color: '#fff',
                    }}>
                      {isInterviewer ? '面试官' : '候选人'}
                    </span>
                    <span style={{
                      fontWeight: 500,
                      fontSize: '13px',
                      color: '#fff',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {participant.userName}
                      {isSelf && <span style={{ color: '#2196f3', marginLeft: '4px', fontSize: '11px' }}>(我)</span>}
                    </span>
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: '#888',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    paddingLeft: '16px',
                  }}>
                    <span>加入: {formatTime(participant.joinedAt)}</span>
                    <span>活跃: {formatTime(participant.lastHeartbeat)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default CandidateRoomView;
