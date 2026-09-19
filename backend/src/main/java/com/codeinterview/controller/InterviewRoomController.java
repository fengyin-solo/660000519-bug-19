package com.codeinterview.controller;

import com.codeinterview.dto.CreateRoomResponse;
import com.codeinterview.dto.JoinRoomResponse;
import com.codeinterview.dto.WebSocketMessage;
import com.codeinterview.model.CandidateInvitation;
import com.codeinterview.model.InterviewRoom;
import com.codeinterview.model.ParticipantStatus;
import com.codeinterview.repository.CandidateInvitationRepository;
import com.codeinterview.repository.InterviewRoomRepository;
import com.codeinterview.service.ParticipantPresenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;

@RestController
@RequestMapping("/api/interview-rooms")
@CrossOrigin(origins = "*")
public class InterviewRoomController {

    @Autowired
    private InterviewRoomRepository interviewRoomRepository;

    @Autowired
    private CandidateInvitationRepository candidateInvitationRepository;

    @Autowired
    private ParticipantPresenceService presenceService;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    private static final String ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final int ROOM_CODE_LENGTH = 6;

    @PostMapping
    @Transactional
    public ResponseEntity<CreateRoomResponse> createInterviewRoom(@RequestBody Map<String, String> request) {
        String title = request.get("title");
        String problemId = request.get("problemId");
        String interviewerId = request.get("interviewerId");
        String interviewerName = request.get("interviewerName");

        InterviewRoom room = new InterviewRoom();
        room.setTitle(title);
        room.setProblemId(problemId);
        room.setInterviewerId(interviewerId);
        room.setStatus("WAITING");
        room.setRoomCode(generateUniqueRoomCode());
        room.setCreatedAt(LocalDateTime.now());

        InterviewRoom savedRoom = interviewRoomRepository.save(room);

        ParticipantStatus interviewerStatus = presenceService.markOnline(
                savedRoom.getId(), interviewerId, interviewerName, "INTERVIEWER");

        return new ResponseEntity<>(new CreateRoomResponse(savedRoom, interviewerStatus), HttpStatus.CREATED);
    }

    @GetMapping("/{roomId}")
    public ResponseEntity<InterviewRoom> getInterviewRoomById(@PathVariable String roomId) {
        Optional<InterviewRoom> room = interviewRoomRepository.findById(roomId);
        return room.map(ResponseEntity::ok)
                .orElseGet(() -> new ResponseEntity<>(HttpStatus.NOT_FOUND));
    }

    @GetMapping("/code/{roomCode}")
    public ResponseEntity<InterviewRoom> getInterviewRoomByCode(@PathVariable String roomCode) {
        Optional<InterviewRoom> room = interviewRoomRepository.findByRoomCode(roomCode);
        return room.map(ResponseEntity::ok)
                .orElseGet(() -> new ResponseEntity<>(HttpStatus.NOT_FOUND));
    }

    @GetMapping("/interviewer/{interviewerId}")
    public ResponseEntity<List<InterviewRoom>> getInterviewRoomsByInterviewer(@PathVariable String interviewerId) {
        List<InterviewRoom> rooms = interviewRoomRepository.findByInterviewerIdOrderByCreatedAtDesc(interviewerId);
        return new ResponseEntity<>(rooms, HttpStatus.OK);
    }

    @PutMapping("/{roomId}/status")
    @Transactional
    public ResponseEntity<InterviewRoom> updateRoomStatus(@PathVariable String roomId, @RequestBody Map<String, String> request) {
        String status = request.get("status");
        Optional<InterviewRoom> roomOpt = interviewRoomRepository.findById(roomId);

        if (roomOpt.isEmpty()) {
            return new ResponseEntity<>(HttpStatus.NOT_FOUND);
        }

        InterviewRoom room = roomOpt.get();
        room.setStatus(status);

        if ("ACTIVE".equals(status) && room.getStartedAt() == null) {
            room.setStartedAt(LocalDateTime.now());
        } else if (("COMPLETED".equals(status) || "CANCELLED".equals(status)) && room.getEndedAt() == null) {
            room.setEndedAt(LocalDateTime.now());
        }

        InterviewRoom updatedRoom = interviewRoomRepository.save(room);

        // 通知所有订阅者（候选人、面试官）房间状态已变化
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/status",
                new WebSocketMessage<>("ROOM_STATUS", updatedRoom));

        return new ResponseEntity<>(updatedRoom, HttpStatus.OK);
    }

    @GetMapping("/{roomId}/participants")
    public ResponseEntity<List<ParticipantStatus>> getRoomParticipants(@PathVariable String roomId) {
        return new ResponseEntity<>(presenceService.listParticipants(roomId), HttpStatus.OK);
    }

    @PostMapping("/{roomId}/join")
    @Transactional
    public ResponseEntity<JoinRoomResponse> joinRoom(@PathVariable String roomId, @RequestBody Map<String, String> request) {
        String candidateName = request.get("candidateName");
        String inviteToken = request.get("inviteToken");

        Optional<InterviewRoom> roomOpt = interviewRoomRepository.findById(roomId);
        if (roomOpt.isEmpty()) {
            return new ResponseEntity<>(HttpStatus.NOT_FOUND);
        }
        InterviewRoom room = roomOpt.get();

        String message = "Joined via room code";

        // 派生稳定身份：邀请链接用邀请ID，保证掉线重进与刷新后都是同一成员；
        // 房间码加入用"房间+姓名"派生，同一候选人再次加入仍合并为同一行。
        String stableUserId;
        if (inviteToken != null && !inviteToken.trim().isEmpty()) {
            Optional<CandidateInvitation> invitationOpt = candidateInvitationRepository.findByInviteToken(inviteToken);
            if (invitationOpt.isEmpty()) {
                return new ResponseEntity<>(HttpStatus.UNAUTHORIZED);
            }

            CandidateInvitation invitation = invitationOpt.get();
            if (!invitation.getRoomId().equals(roomId)) {
                return new ResponseEntity<>(HttpStatus.BAD_REQUEST);
            }

            if (!"JOINED".equals(invitation.getStatus())) {
                invitation.setStatus("JOINED");
                invitation.setJoinedAt(LocalDateTime.now());
                candidateInvitationRepository.save(invitation);
            }
            stableUserId = "candidate-inv-" + invitation.getId();
            message = "Joined via invitation token";
        } else {
            stableUserId = "candidate-code-" + shortHash(roomId + ":" + candidateName.trim().toLowerCase());
        }

        // 幂等加入：已有记录直接复活并保留原始 joinedAt，仅真实上线时广播一次
        ParticipantStatus candidateStatus = presenceService.joinCandidate(
                roomId, candidateName, "CANDIDATE", stableUserId);

        JoinRoomResponse response = new JoinRoomResponse(candidateStatus, room, message);
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    @PostMapping("/{roomId}/leave")
    @Transactional
    public ResponseEntity<Void> leaveRoom(@PathVariable String roomId, @RequestBody Map<String, String> request) {
        String userId = request.get("userId");

        if (userId == null || presenceService.listParticipants(roomId).stream()
                .noneMatch(p -> userId.equals(p.getUserId()))) {
            return new ResponseEntity<>(HttpStatus.NOT_FOUND);
        }

        presenceService.markLeft(roomId, userId);
        return new ResponseEntity<>(HttpStatus.OK);
    }

    @PostMapping("/{roomId}/heartbeat")
    @Transactional
    public ResponseEntity<ParticipantStatus> heartbeat(@PathVariable String roomId, @RequestBody Map<String, String> request) {
        String userId = request.get("userId");
        String userName = request.get("userName");
        String userRole = request.get("userRole");

        // markOnline 内部处理了"记录不存在则创建"，断网后心跳恢复也能即时复活；
        // 普通心跳不广播，避免风暴
        ParticipantStatus updatedStatus = presenceService.markOnline(roomId, userId, userName, userRole);
        if (updatedStatus == null) {
            return new ResponseEntity<>(HttpStatus.NOT_FOUND);
        }
        return new ResponseEntity<>(updatedStatus, HttpStatus.OK);
    }

    private String shortHash(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < 8 && i < hash.length; i++) {
                hex.append(String.format("%02x", hash[i]));
            }
            return hex.toString();
        } catch (Exception e) {
            return Integer.toHexString(input.hashCode());
        }
    }

    private String generateUniqueRoomCode() {
        Random random = new Random();
        String code;
        do {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < ROOM_CODE_LENGTH; i++) {
                sb.append(ROOM_CODE_CHARS.charAt(random.nextInt(ROOM_CODE_CHARS.length())));
            }
            code = sb.toString();
        } while (interviewRoomRepository.existsByRoomCode(code));
        return code;
    }
}
