package com.codeinterview.controller;

import com.codeinterview.dto.WebSocketMessage;
import com.codeinterview.model.InterviewRoom;
import com.codeinterview.model.ParticipantStatus;
import com.codeinterview.repository.InterviewRoomRepository;
import com.codeinterview.service.ParticipantPresenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.stereotype.Controller;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Controller
public class WebSocketController {

    @Autowired
    private ParticipantPresenceService presenceService;

    @Autowired
    private InterviewRoomRepository interviewRoomRepository;

    /**
     * 主动拉取一次当前房间参与者全量列表（仅应答给请求方，不广播）。
     */
    @MessageMapping("/room/{roomId}/participants")
    @SendTo("/topic/room/{roomId}/participants")
    public WebSocketMessage<List<ParticipantStatus>> getRoomParticipants(
            @DestinationVariable String roomId,
            SimpMessageHeaderAccessor headerAccessor) {

        Map<String, Object> attributes = headerAccessor.getSessionAttributes();
        if (attributes != null) {
            attributes.put("roomId", roomId);
        }

        List<ParticipantStatus> participants = presenceService.listParticipants(roomId);
        return new WebSocketMessage<>("PARTICIPANTS_LIST", participants);
    }

    /**
     * 主动拉取一次当前房间状态（仅应答给请求方，不广播）。
     */
    @MessageMapping("/room/{roomId}/status")
    @SendTo("/topic/room/{roomId}/status")
    public WebSocketMessage<InterviewRoom> getRoomStatus(
            @DestinationVariable String roomId,
            SimpMessageHeaderAccessor headerAccessor) {

        Map<String, Object> attributes = headerAccessor.getSessionAttributes();
        if (attributes != null) {
            attributes.put("roomId", roomId);
        }

        Optional<InterviewRoom> room = interviewRoomRepository.findById(roomId);
        return new WebSocketMessage<>("ROOM_STATUS", room.orElse(null));
    }

    /**
     * WebSocket 心跳：刷新在线状态。普通心跳不广播，只有成员首次出现或从离线
     * 复活时，服务内部才会广播一次。这里返回的 ACK 只发给请求方自身。
     */
    @MessageMapping("/heartbeat")
    public WebSocketMessage<ParticipantStatus> handleHeartbeat(
            WebSocketMessage<Map<String, String>> message,
            SimpMessageHeaderAccessor headerAccessor) {

        Map<String, String> payload = message.getPayload();

        String roomId = headerAccessor.getFirstNativeHeader("roomId");
        String userId = headerAccessor.getFirstNativeHeader("userId");
        String userName = headerAccessor.getFirstNativeHeader("userName");
        String userRole = headerAccessor.getFirstNativeHeader("userRole");

        if (payload != null) {
            if (roomId == null) roomId = payload.get("roomId");
            if (userId == null) userId = payload.get("userId");
            if (userName == null) userName = payload.get("userName");
            if (userRole == null) userRole = payload.get("userRole");
        }

        Map<String, Object> attributes = headerAccessor.getSessionAttributes();
        if (attributes != null) {
            if (roomId != null) attributes.put("roomId", roomId);
            if (userId != null) attributes.put("userId", userId);
            if (userName != null) attributes.put("userName", userName);
            if (userRole != null) attributes.put("userRole", userRole);
        }

        ParticipantStatus status = presenceService.markOnline(roomId, userId, userName, userRole);
        if (status != null) {
            return new WebSocketMessage<>("HEARTBEAT_ACK", status);
        }
        return new WebSocketMessage<>("HEARTBEAT_ACK", null);
    }
}
