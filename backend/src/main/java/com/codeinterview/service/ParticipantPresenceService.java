package com.codeinterview.service;

import com.codeinterview.dto.WebSocketMessage;
import com.codeinterview.model.ParticipantStatus;
import com.codeinterview.repository.ParticipantStatusRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 参与者在线状态的唯一入口。
 *
 * 设计目标：
 * 1. 网络波动（WebSocket 断开/重连、心跳晚到）不会立刻让成员上下线，
 *    只有超过 {@link #OFFLINE_GRACE_SECONDS} 秒没有心跳才判定为离线。
 * 2. 掉线后重进复用同一条参与者记录，保留原始 joinedAt。
 * 3. 只有在线状态发生真实变化（新加入 / 复活 / 真正离开）时才广播一次列表，
 *    普通心跳不产生任何广播。
 */
@Service
public class ParticipantPresenceService {

    private static final Logger logger = LoggerFactory.getLogger(ParticipantPresenceService.class);

    /** 离线宽限期：超过该时长没有心跳才标记离线，覆盖短暂的连接抖动与重连。 */
    private static final long OFFLINE_GRACE_SECONDS = 45;

    /** 定时扫描超时在线成员的频率。 */
    private static final long SWEEP_INTERVAL_MS = 10_000;

    private final ParticipantStatusRepository participantStatusRepository;
    private final SimpMessagingTemplate messagingTemplate;

    @Autowired
    public ParticipantPresenceService(ParticipantStatusRepository participantStatusRepository,
                                      SimpMessagingTemplate messagingTemplate) {
        this.participantStatusRepository = participantStatusRepository;
        this.messagingTemplate = messagingTemplate;
    }

    public List<ParticipantStatus> listParticipants(String roomId) {
        return participantStatusRepository.findByRoomId(roomId);
    }

    /**
     * 记录一次"上线/心跳"。仅在成员首次出现或从离线复活时广播一次。
     *
     * @return 更新后的参与者状态；身份信息不足时返回 null
     */
    @Transactional
    public synchronized ParticipantStatus markOnline(String roomId, String userId,
                                                     String userName, String userRole) {
        if (roomId == null || userId == null) {
            return null;
        }

        Optional<ParticipantStatus> existingOpt =
                participantStatusRepository.findByRoomIdAndUserId(roomId, userId);

        // 兜底：历史数据中 userId 缺失，但同一房间内同角色同姓名的记录视为同一人
        if (existingOpt.isEmpty() && userRole != null && userName != null && !userName.isBlank()) {
            existingOpt = participantStatusRepository
                    .findFirstByRoomIdAndUserRoleAndUserNameOrderByJoinedAtAsc(roomId, userRole, userName);
        }

        LocalDateTime now = LocalDateTime.now();
        boolean presenceChanged;

        ParticipantStatus status;
        if (existingOpt.isPresent()) {
            status = existingOpt.get();
            boolean wasOffline = !status.isOnline();
            status.setOnline(true);
            status.setLastHeartbeat(now);
            if (userName != null && !userName.isBlank()) {
                status.setUserName(userName);
            }
            if (userRole != null && !userRole.isBlank()) {
                status.setUserRole(userRole);
            }
            if (status.getUserId() == null || status.getUserId().isBlank()) {
                status.setUserId(userId);
            }
            // 复活才算真实变化；普通心跳不广播
            presenceChanged = wasOffline;
        } else {
            status = new ParticipantStatus();
            status.setRoomId(roomId);
            status.setUserId(userId);
            status.setUserName(userName);
            status.setUserRole(userRole);
            status.setOnline(true);
            status.setJoinedAt(now);
            status.setLastHeartbeat(now);
            presenceChanged = true;
        }

        participantStatusRepository.save(status);

        if (presenceChanged) {
            broadcastParticipants(roomId);
        }
        return status;
    }

    /**
     * 候选人加入房间（邀请链接或房间码）。幂等：同一身份重复加入合并为同一成员，
     * 保留最早的 joinedAt，仅在真正变为在线时广播一次。
     *
     * @param stableUserId 调用方保证稳定的身份标识（邀请场景用邀请ID，房间码场景用房间+姓名派生）
     */
    @Transactional
    public synchronized ParticipantStatus joinCandidate(String roomId, String candidateName,
                                                        String userRole, String stableUserId) {
        Optional<ParticipantStatus> existingOpt =
                participantStatusRepository.findByRoomIdAndUserId(roomId, stableUserId);

        // 房间码加入的稳定身份基于姓名派生，正常不会走到这里；
        // 该兜底用于兼容历史上已存在的同房间同姓名候选人记录
        if (existingOpt.isEmpty() && candidateName != null && !candidateName.isBlank()) {
            existingOpt = participantStatusRepository
                    .findFirstByRoomIdAndUserRoleAndUserNameOrderByJoinedAtAsc(
                            roomId, userRole, candidateName);
        }

        LocalDateTime now = LocalDateTime.now();
        boolean presenceChanged;

        ParticipantStatus status;
        if (existingOpt.isPresent()) {
            status = existingOpt.get();
            presenceChanged = !status.isOnline();
            status.setOnline(true);
            status.setLastHeartbeat(now);
            status.setUserName(candidateName);
            if (userRole != null && !userRole.isBlank()) {
                status.setUserRole(userRole);
            }
            if (status.getUserId() == null || status.getUserId().isBlank()) {
                status.setUserId(stableUserId);
            }
            // joinedAt 保持不变 —— 重进合并为同一成员并保留原加入时间
        } else {
            status = new ParticipantStatus();
            status.setRoomId(roomId);
            status.setUserId(stableUserId);
            status.setUserName(candidateName);
            status.setUserRole(userRole);
            status.setOnline(true);
            status.setJoinedAt(now);
            status.setLastHeartbeat(now);
            presenceChanged = true;
        }

        participantStatusRepository.save(status);

        if (presenceChanged) {
            broadcastParticipants(roomId);
        }
        return status;
    }

    /** 显式离开房间：立即标记离线并广播一次。 */
    @Transactional
    public synchronized void markLeft(String roomId, String userId) {
        if (roomId == null || userId == null) {
            return;
        }
        Optional<ParticipantStatus> existingOpt =
                participantStatusRepository.findByRoomIdAndUserId(roomId, userId);
        if (existingOpt.isEmpty()) {
            return;
        }
        ParticipantStatus status = existingOpt.get();
        if (!status.isOnline()) {
            return;
        }
        status.setOnline(false);
        status.setLastHeartbeat(LocalDateTime.now());
        participantStatusRepository.save(status);
        broadcastParticipants(roomId);
    }

    /**
     * 定时清理：超过宽限期没有心跳的在线成员统一标记为离线。
     * 每个发生变化的房间只广播一次。
     */
    @Scheduled(fixedRate = SWEEP_INTERVAL_MS)
    @Transactional
    public synchronized void sweepStaleParticipants() {
        LocalDateTime threshold = LocalDateTime.now().minusSeconds(OFFLINE_GRACE_SECONDS);
        List<ParticipantStatus> all = participantStatusRepository.findAll();

        java.util.Set<String> changedRooms = new java.util.HashSet<>();
        for (ParticipantStatus status : all) {
            if (status.isOnline()
                    && status.getLastHeartbeat() != null
                    && status.getLastHeartbeat().isBefore(threshold)) {
                status.setOnline(false);
                participantStatusRepository.save(status);
                changedRooms.add(status.getRoomId());
                logger.info("Participant marked offline after grace period - roomId: {}, userId: {}",
                        status.getRoomId(), status.getUserId());
            }
        }

        for (String roomId : changedRooms) {
            broadcastParticipants(roomId);
        }
    }

    private void broadcastParticipants(String roomId) {
        List<ParticipantStatus> participants = participantStatusRepository.findByRoomId(roomId);
        messagingTemplate.convertAndSend(
                "/topic/room/" + roomId + "/participants",
                new WebSocketMessage<>("PARTICIPANTS_UPDATE", participants));
    }
}
