// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EWasteAudit: tamper-evident anchors for e-waste custody, dispatch plans
///        and single-use recovery certificates
/// @notice Stores only hashes. Operational data stays off-chain.
contract EWasteAudit {
    address public admin;
    mapping(address => bool) public isAttestor;

    struct Anchor {
        bytes32 headHash;
        uint32  eventCount;
        uint64  anchoredAt;
        address attestor;
    }

    struct Certificate {
        bytes32 certHash;
        uint64  issuedAt;
        uint64  retiredAt;     // 0 = not yet used
    }

    mapping(bytes32 => Anchor) public batchAnchors;        // keccak256(batchId)
    mapping(bytes32 => uint64) public planAnchoredAt;      // planHash => timestamp
    mapping(bytes32 => Certificate) public certificates;   // keccak256(certId)

    event AttestorSet(address indexed account, bool allowed);
    event BatchHeadAnchored(bytes32 indexed batchKey, string batchId,
                            bytes32 headHash, uint32 eventCount, address indexed attestor);
    event PlanAnchored(bytes32 indexed planHash, bytes32 scenarioHash,
                       string runId, address indexed attestor);
    event CertificateIssued(bytes32 indexed certKey, string certId,
                            bytes32 certHash, address indexed attestor);
    event CertificateRetired(bytes32 indexed certKey, string certId,
                             string retiredBy, address indexed attestor);

    modifier onlyAdmin() { require(msg.sender == admin, "not admin"); _; }
    modifier onlyAttestor() { require(isAttestor[msg.sender], "not attestor"); _; }

    constructor() {
        admin = msg.sender;
        isAttestor[msg.sender] = true;
        emit AttestorSet(msg.sender, true);
    }

    function setAttestor(address account, bool allowed) external onlyAdmin {
        isAttestor[account] = allowed;
        emit AttestorSet(account, allowed);
    }

    // ---------- batch audit chains ----------
    function anchorBatchHead(string calldata batchId, bytes32 headHash, uint32 eventCount)
        external onlyAttestor
    {
        require(headHash != bytes32(0), "empty hash");
        bytes32 key = keccak256(bytes(batchId));
        require(eventCount > batchAnchors[key].eventCount, "stale or replayed anchor");
        batchAnchors[key] = Anchor(headHash, eventCount, uint64(block.timestamp), msg.sender);
        emit BatchHeadAnchored(key, batchId, headHash, eventCount, msg.sender);
    }

    function getBatchAnchor(string calldata batchId) external view returns (Anchor memory) {
        return batchAnchors[keccak256(bytes(batchId))];
    }

    // ---------- QpiAI dispatch plans ----------
    function anchorPlan(bytes32 planHash, bytes32 scenarioHash, string calldata runId)
        external onlyAttestor
    {
        require(planHash != bytes32(0), "empty hash");
        require(planAnchoredAt[planHash] == 0, "plan already anchored");
        planAnchoredAt[planHash] = uint64(block.timestamp);
        emit PlanAnchored(planHash, scenarioHash, runId, msg.sender);
    }

    // ---------- single-use recovery certificates ----------
    function issueCertificate(string calldata certId, bytes32 certHash) external onlyAttestor {
        require(certHash != bytes32(0), "empty hash");
        bytes32 key = keccak256(bytes(certId));
        require(certificates[key].issuedAt == 0, "certificate already issued");
        certificates[key] = Certificate(certHash, uint64(block.timestamp), 0);
        emit CertificateIssued(key, certId, certHash, msg.sender);
    }

    function retireCertificate(string calldata certId, bytes32 certHash, string calldata retiredBy)
        external onlyAttestor
    {
        bytes32 key = keccak256(bytes(certId));
        Certificate storage cert = certificates[key];
        require(cert.issuedAt != 0, "certificate not issued");
        require(cert.certHash == certHash, "certificate hash mismatch");
        require(cert.retiredAt == 0, "certificate already retired");
        cert.retiredAt = uint64(block.timestamp);
        emit CertificateRetired(key, certId, retiredBy, msg.sender);
    }

    function getCertificate(string calldata certId) external view returns (Certificate memory) {
        return certificates[keccak256(bytes(certId))];
    }
}