package com.codeinterview.repository;

import com.codeinterview.model.ParticipantStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Repository
public interface ParticipantStatusRepository extends JpaRepository<ParticipantStatus, String> {
    List<ParticipantStatus> findByRoomId(String roomId);
    Optional<ParticipantStatus> findByRoomIdAndUserId(String roomId, String userId);
    Optional<ParticipantStatus> findFirstByRoomIdAndUserRoleAndUserNameOrderByJoinedAtAsc(
            String roomId, String userRole, String userName);
    @Modifying
    @Transactional
    void deleteByRoomIdAndUserId(String roomId, String userId);
}
