package com.codeinterview.config;

import com.codeinterview.service.ParticipantPresenceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionConnectEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.Map;

/**
 * WebSocket 会话事件处理。
 *
 * 网络波动时 SockJS/STOMP 可能频繁断开重连，因此 DISCONNECT 事件不立即将成员
 * 标记离线，而是由 {@link ParticipantPresenceService#sweepStaleParticipants()}
 * 在宽限期（45s）后统一处理；重连后的首次心跳/连接事件会立刻复活记录，
 * 整个过程中参与者不会"先消失再出现"，加入通知也只在真实变化时产生一次。
 */
@Component
public class WebSocketEventListener {

    private static final Logger logger = LoggerFactory.getLogger(WebSocketEventListener.class);

    @Autowired
    private ParticipantPresenceService presenceService;

    @EventListener
    public void handleWebSocketConnectListener(SessionConnectEvent event) {
        SimpMessageHeaderAccessor headerAccessor = SimpMessageHeaderAccessor.wrap(event.getMessage());
        Map<String, Object> attributes = headerAccessor.getSessionAttributes();

        String roomId = headerAccessor.getFirstNativeHeader("roomId");
        String userId = headerAccessor.getFirstNativeHeader("userId");
        String userName = headerAccessor.getFirstNativeHeader("userName");
        String userRole = headerAccessor.getFirstNativeHeader("userRole");

        if (roomId == null && attributes != null) {
            roomId = (String) attributes.get("roomId");
        }
        if (userId == null && attributes != null) {
            userId = (String) attributes.get("userId");
        }
        if (userName == null && attributes != null) {
            userName = (String) attributes.get("userName");
        }
        if (userRole == null && attributes != null) {
            userRole = (String) attributes.get("userRole");
        }

        logger.info("WebSocket connected - roomId: {}, userId: {}, userName: {}, userRole: {}",
                roomId, userId, userName, userRole);

        if (attributes != null) {
            if (roomId != null) attributes.put("roomId", roomId);
            if (userId != null) attributes.put("userId", userId);
            if (userName != null) attributes.put("userName", userName);
            if (userRole != null) attributes.put("userRole", userRole);
        }

        presenceService.markOnline(roomId, userId, userName, userRole);
    }

    @EventListener
    public void handleWebSocketDisconnectListener(SessionDisconnectEvent event) {
        SimpMessageHeaderAccessor headerAccessor = SimpMessageHeaderAccessor.wrap(event.getMessage());
        Map<String, Object> attributes = headerAccessor.getSessionAttributes();

        String roomId = attributes == null ? null : (String) attributes.get("roomId");
        String userId = attributes == null ? null : (String) attributes.get("userId");

        // 仅记录日志，不立即标记离线。心跳宽限期到期后 sweep 任务才真正下线，
        // 重连会通过连接/心跳事件即时复活，避免短暂断线导致的状态抖动。
        logger.info("WebSocket disconnected (grace period applies) - roomId: {}, userId: {}",
                roomId, userId);
    }
}
